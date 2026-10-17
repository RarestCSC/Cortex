//! Capabilities an OpenAI-compatible endpoint states about itself.
//!
//! Three sources answer "what can this model do", and the pipeline consumes all
//! three in this order: the user's own model declaration, the endpoint's
//! `GET /v1/models` metadata, and the public catalog's guess. Endpoints that
//! declare nothing at all — one-api style relays ship only an id list — fall
//! back to a runtime probe whose verdicts are cached on disk, so they work with
//! zero configuration.

use crate::errors::ProviderError;
use crate::thinking::ThinkingEffort;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Effort levels in the order a menu should present them.
const EFFORT_ORDER: [ThinkingEffort; 5] = [
    ThinkingEffort::Off,
    ThinkingEffort::Low,
    ThinkingEffort::Medium,
    ThinkingEffort::High,
    ThinkingEffort::Max,
];

/// Terms that mark a 4xx body as "this model cannot do that" rather than "try
/// again". Used to decide whether the identical payload is worth resending.
const REFUSAL_TERMS: &[&str] = &[
    "not support",
    "unsupported",
    "unrecognized",
    "unrecognised",
    "unknown",
    "invalid",
    "not allowed",
    "cannot",
    "can't",
    "must be",
];

/// Terms that make a rejection about size or budget rather than about
/// capability. Those keep their existing retry/classification behaviour.
const NON_CAPABILITY_TERMS: &[&str] = &[
    "too large",
    "too long",
    "exceed",
    "maximum",
    "quota",
    "rate limit",
];

/// What an endpoint said about one model, in its own words.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndpointModelCapabilities {
    /// `supports_images`, or `architecture.input_modalities` listing `image`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
    /// `supports_reasoning`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_reasoning: Option<bool>,
    /// `reasoning_supported_efforts`, kept verbatim: the endpoint's vocabulary
    /// is not Cortex's, and only the endpoint knows which words it accepts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_supported_efforts: Option<Vec<String>>,
    /// `reasoning_default_effort`, kept verbatim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_default_effort: Option<String>,
    /// `can_disable_thinking`. Absent means the endpoint never mentioned it,
    /// which is not the same as an explicit `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub can_disable_thinking: Option<bool>,
}

impl EndpointModelCapabilities {
    /// Read the capability fields from one `/v1/models` entry.
    pub fn from_models_entry(entry: &Value) -> Self {
        Self {
            supports_vision: entry
                .get("supports_images")
                .and_then(Value::as_bool)
                .or_else(|| declares_image_input(entry)),
            supports_reasoning: entry.get("supports_reasoning").and_then(Value::as_bool),
            reasoning_supported_efforts: effort_words(entry.get("reasoning_supported_efforts")),
            reasoning_default_effort: entry
                .get("reasoning_default_effort")
                .and_then(Value::as_str)
                .map(str::to_string),
            can_disable_thinking: entry.get("can_disable_thinking").and_then(Value::as_bool),
        }
    }

    /// `None` when the endpoint listed this model without any capability
    /// metadata. Distinct from `ModelConfig::endpoint_capabilities` being
    /// absent: that means nobody asked, this means the endpoint answered
    /// "nothing to declare".
    pub fn declares_nothing(&self) -> bool {
        self.supports_vision.is_none()
            && self.supports_reasoning.is_none()
            && self.reasoning_supported_efforts.is_none()
            && self.reasoning_default_effort.is_none()
            && self.can_disable_thinking.is_none()
    }

    /// The effort levels this endpoint accepts, deduplicated and ordered.
    /// Empty when it declared no vocabulary.
    pub fn effort_levels(&self) -> Vec<ThinkingEffort> {
        let Some(words) = self.reasoning_supported_efforts.as_deref() else {
            return Vec::new();
        };
        let levels: Vec<ThinkingEffort> = words
            .iter()
            .filter_map(|word| word.parse::<ThinkingEffort>().ok())
            .collect();
        EFFORT_ORDER
            .iter()
            .copied()
            .filter(|effort| levels.contains(effort))
            .collect()
    }

    /// The word this endpoint uses for `effort`.
    ///
    /// Resolved against the declared vocabulary rather than hardcoded, because
    /// the two vocabularies disagree: Cortex's top level is `max` while a
    /// gateway may call it `xhigh`, and "turn reasoning off" is `none` to some
    /// endpoints and `off` to others. `None` means the endpoint declared no
    /// word for this level, and the caller keeps its own fallback.
    ///
    /// Where two words mean the same level the fuller one wins, so the answer
    /// never depends on the order the gateway happened to list them in: a
    /// gateway publishing both `max` and `xhigh` gets `max`, the same word it
    /// uses in `reasoning_default_effort`.
    pub fn word_for(&self, effort: ThinkingEffort) -> Option<String> {
        let words = self.reasoning_supported_efforts.as_deref()?;
        let spellings: &[&str] = match effort {
            ThinkingEffort::Off => &["none", "off"],
            ThinkingEffort::Low => &["low"],
            ThinkingEffort::Medium => &["medium"],
            ThinkingEffort::High => &["high"],
            ThinkingEffort::Max => &["max", "xhigh"],
        };
        spellings.iter().find_map(|spelling| {
            words
                .iter()
                .find(|word| word.eq_ignore_ascii_case(spelling))
                .cloned()
        })
    }

    /// The level this endpoint runs at when the caller says nothing.
    pub fn default_effort(&self) -> Option<ThinkingEffort> {
        self.reasoning_default_effort
            .as_deref()?
            .parse::<ThinkingEffort>()
            .ok()
    }

    /// Whether picking a level can actually change anything. Endpoints that
    /// accept `reasoning_effort` but offer exactly one level cannot.
    pub fn is_effort_selectable(&self) -> bool {
        self.effort_levels().len() > 1 || self.supports_reasoning == Some(true)
    }
}

/// Read one model's capabilities out of a `GET /v1/models` body.
///
/// `None` when the endpoint did not list the model at all. Listing it with no
/// metadata returns an all-`None` record instead, because "listed but silent"
/// and "never asked" lead to different decisions.
pub fn from_models_response(json: &Value, model_name: &str) -> Option<EndpointModelCapabilities> {
    let entry = models_entries(json)?
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(model_name))?;
    Some(EndpointModelCapabilities::from_models_entry(entry))
}

fn models_entries(json: &Value) -> Option<&Vec<Value>> {
    json.get("data")
        .and_then(Value::as_array)
        .or_else(|| json.as_array())
}

fn declares_image_input(entry: &Value) -> Option<bool> {
    let modalities = entry
        .get("architecture")
        .and_then(|architecture| architecture.get("input_modalities"))?
        .as_array()?;
    Some(
        modalities
            .iter()
            .filter_map(Value::as_str)
            .any(|modality| modality.eq_ignore_ascii_case("image")),
    )
}

fn effort_words(value: Option<&Value>) -> Option<Vec<String>> {
    let words: Vec<String> = value?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .filter(|word| word.parse::<ThinkingEffort>().is_ok())
        .map(str::to_string)
        .collect();
    (!words.is_empty()).then_some(words)
}

// ---------------------------------------------------------------------------
// Process-wide registry
// ---------------------------------------------------------------------------
//
// `ModelConfig` is built synchronously from a provider name while the endpoint's
// metadata arrives asynchronously over HTTP. Both sources are published here;
// `ModelConfig` construction looks them up. Keyed by provider name because that
// is the only identity `ModelConfig` construction has.

/// What the user's own provider configuration says about a model.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DeclaredCapabilities {
    /// `ModelInfo.reasoning`. `None` when the provider entry never had a reason
    /// to state one, which leaves the catalog free to answer instead.
    pub reasoning: Option<bool>,
    /// `ModelInfo.supports_vision`, already tri-state.
    pub supports_vision: Option<bool>,
}

/// Everything known about a model: the user's declaration first, then the
/// endpoint's own metadata.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolvedCapabilities {
    pub declared: DeclaredCapabilities,
    pub endpoint: Option<EndpointModelCapabilities>,
}

type RegistryKey = (String, String);

fn declared_registry() -> &'static RwLock<HashMap<RegistryKey, DeclaredCapabilities>> {
    static REGISTRY: OnceLock<RwLock<HashMap<RegistryKey, DeclaredCapabilities>>> = OnceLock::new();
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

fn endpoint_registry() -> &'static RwLock<HashMap<RegistryKey, EndpointModelCapabilities>> {
    static REGISTRY: OnceLock<RwLock<HashMap<RegistryKey, EndpointModelCapabilities>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn publish_declared(provider_name: &str, model_name: &str, declared: DeclaredCapabilities) {
    if let Ok(mut registry) = declared_registry().write() {
        registry.insert(
            (provider_name.to_string(), model_name.to_string()),
            declared,
        );
    }
}

pub fn publish_endpoint(
    provider_name: &str,
    model_name: &str,
    capabilities: EndpointModelCapabilities,
) {
    if let Ok(mut registry) = endpoint_registry().write() {
        registry.insert(
            (provider_name.to_string(), model_name.to_string()),
            capabilities,
        );
    }
}

pub fn lookup(provider_name: &str, model_name: &str) -> ResolvedCapabilities {
    let key = (provider_name.to_string(), model_name.to_string());
    ResolvedCapabilities {
        declared: declared_registry()
            .read()
            .ok()
            .and_then(|registry| registry.get(&key).copied())
            .unwrap_or_default(),
        endpoint: endpoint_registry()
            .read()
            .ok()
            .and_then(|registry| registry.get(&key).cloned()),
    }
}

/// Drop one provider's declarations, so an edit is visible without a restart.
pub fn forget_declared(provider_name: &str) {
    if let Ok(mut registry) = declared_registry().write() {
        registry.retain(|(provider, _), _| provider != provider_name);
    }
}

/// Drop every published record. Test-only: the registries are process-global
/// and otherwise have no legitimate reset point.
#[cfg(test)]
pub fn clear_registries() {
    if let Ok(mut registry) = declared_registry().write() {
        registry.clear();
    }
    if let Ok(mut registry) = endpoint_registry().write() {
        registry.clear();
    }
}

// ---------------------------------------------------------------------------
// Probe cache
// ---------------------------------------------------------------------------

/// How long a probe verdict is trusted. Verdicts are negative ("this endpoint
/// refused X"), so they only go stale when the gateway is upgraded; expiring
/// them costs one rejected request, while never expiring them would make a
/// fixed gateway impossible without deleting the file by hand.
const PROBE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

const CACHE_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ProbeCacheFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    endpoints: HashMap<String, EndpointProbe>,
}

/// One base_url's probe history, stored under the hash of that base_url.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct EndpointProbe {
    /// Kept alongside the hash so the file stays readable and the hash
    /// verifiable by hand.
    base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    supports_responses_api: Option<ProbeVerdict>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    models: Option<HashMap<String, ModelProbe>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelProbe {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    supports_vision: Option<ProbeVerdict>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    supports_thinking_effort: Option<ProbeVerdict>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct ProbeVerdict {
    supported: bool,
    checked_at: u64,
}

impl ProbeVerdict {
    fn now(supported: bool) -> Self {
        Self {
            supported,
            checked_at: now_secs(),
        }
    }

    fn is_fresh(self) -> bool {
        now_secs().saturating_sub(self.checked_at) <= PROBE_TTL.as_secs()
    }
}

/// Runtime-probe verdicts for endpoints that declare no capabilities.
///
/// The store is best effort: every method swallows I/O failures, because a
/// cache miss only costs one more rejected request, while failing a request
/// over a cache write would be a strictly worse trade.
pub struct ProbeCache {
    path: PathBuf,
    file: Mutex<ProbeCacheFile>,
}

impl std::fmt::Debug for ProbeCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProbeCache")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl ProbeCache {
    /// Load an existing cache file, or start an empty one.
    pub fn load(path: PathBuf) -> Self {
        let file = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ProbeCacheFile>(&bytes).ok())
            .filter(|file| file.version == CACHE_VERSION)
            .unwrap_or_default();
        Self {
            path,
            file: Mutex::new(file),
        }
    }

    pub fn supports_responses_api(&self, base_url: &str) -> Option<bool> {
        self.read(base_url, |probe| probe.supports_responses_api)
    }

    pub fn supports_vision(&self, base_url: &str, model_name: &str) -> Option<bool> {
        self.read_model(base_url, model_name, |probe| probe.supports_vision)
    }

    pub fn supports_thinking_effort(&self, base_url: &str, model_name: &str) -> Option<bool> {
        self.read_model(base_url, model_name, |probe| probe.supports_thinking_effort)
    }

    pub fn record_responses_api(&self, base_url: &str, supported: bool) {
        self.record(base_url, |probe| {
            probe.supports_responses_api = Some(ProbeVerdict::now(supported));
        });
    }

    pub fn record_vision(&self, base_url: &str, model_name: &str, supported: bool) {
        self.record(base_url, |probe| {
            model_probe(probe, model_name).supports_vision = Some(ProbeVerdict::now(supported));
        });
    }

    pub fn record_thinking_effort(&self, base_url: &str, model_name: &str, supported: bool) {
        self.record(base_url, |probe| {
            model_probe(probe, model_name).supports_thinking_effort =
                Some(ProbeVerdict::now(supported));
        });
    }

    fn read(
        &self,
        base_url: &str,
        select: impl Fn(&EndpointProbe) -> Option<ProbeVerdict>,
    ) -> Option<bool> {
        let file = self.file.lock().ok()?;
        let verdict = select(file.endpoints.get(&endpoint_key(base_url))?)?;
        verdict.is_fresh().then_some(verdict.supported)
    }

    fn read_model(
        &self,
        base_url: &str,
        model_name: &str,
        select: impl Fn(&ModelProbe) -> Option<ProbeVerdict>,
    ) -> Option<bool> {
        let file = self.file.lock().ok()?;
        let endpoint = file.endpoints.get(&endpoint_key(base_url))?;
        let verdict = select(endpoint.models.as_ref()?.get(model_name)?)?;
        verdict.is_fresh().then_some(verdict.supported)
    }

    fn record(&self, base_url: &str, mutate: impl FnOnce(&mut EndpointProbe)) {
        let Ok(mut file) = self.file.lock() else {
            return;
        };
        file.version = CACHE_VERSION;
        let key = endpoint_key(base_url);
        let probe = file
            .endpoints
            .entry(key.clone())
            .or_insert_with(|| EndpointProbe {
                base_url: base_url.to_string(),
                supports_responses_api: None,
                models: None,
            });
        probe.base_url = base_url.to_string();
        mutate(probe);
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(serialized) = serde_json::to_string_pretty(&*file) {
            let _ = std::fs::write(&self.path, serialized);
        }
    }
}

fn model_probe<'a>(probe: &'a mut EndpointProbe, model_name: &str) -> &'a mut ModelProbe {
    probe
        .models
        .get_or_insert_with(HashMap::new)
        .entry(model_name.to_string())
        .or_insert_with(|| ModelProbe {
            supports_vision: None,
            supports_thinking_effort: None,
        })
}

/// FNV-1a over the normalized base_url. Dependency-free and stable across
/// builds, unlike `DefaultHasher`.
fn endpoint_key(base_url: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalized.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Rejection classification
// ---------------------------------------------------------------------------

/// A request feature the endpoint explicitly refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityRejection {
    Vision,
    ThinkingEffort,
}

/// Classify a provider error as "this model cannot do that".
///
/// Only used to decide whether a downgraded retry is worth making; the caller
/// still has to know that the payload actually carried the refused feature,
/// since the same words can appear in unrelated 400s.
pub fn capability_rejection(error: &ProviderError) -> Option<CapabilityRejection> {
    let message = match error {
        ProviderError::RequestFailed(message) => message.to_lowercase(),
        ProviderError::ExecutionError(message) => message.to_lowercase(),
        _ => return None,
    };
    if NON_CAPABILITY_TERMS
        .iter()
        .any(|term| message.contains(term))
    {
        return None;
    }
    let refused = REFUSAL_TERMS.iter().any(|term| message.contains(term));
    if !refused {
        return None;
    }
    let mentions = |subjects: &[&str]| subjects.iter().any(|term| message.contains(term));

    if mentions(&["reasoning_effort", "reasoning.effort", "thinking_effort"]) {
        return Some(CapabilityRejection::ThinkingEffort);
    }
    if mentions(&["image", "vision", "image_url", "multimodal"]) {
        return Some(CapabilityRejection::Vision);
    }
    None
}

/// Whether an error means "this base_url has no Responses API here", which is
/// what the routing fallback keys on.
///
/// Deliberately narrow. A bare "not found" is excluded because a 400 saying
/// "model not found" is a naming problem, and rerouting it would answer the
/// wrong question with a working request.
pub fn is_missing_endpoint(error: &ProviderError) -> bool {
    match error {
        ProviderError::EndpointNotFound(_) => true,
        ProviderError::RequestFailed(message) => {
            let message = message.to_lowercase();
            message.contains("404")
                || message.contains("405")
                || message.contains("not implemented")
                || message.contains("no route")
                || message.contains("unsupported endpoint")
        }
        _ => false,
    }
}

/// Read a cache file for tests and diagnostics.
pub fn read_probe_cache(path: &Path) -> Option<serde_json::Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cache_file() -> ProbeCacheFile {
        ProbeCacheFile {
            version: CACHE_VERSION,
            endpoints: HashMap::new(),
        }
    }

    #[test]
    fn workbuddy_entry_keeps_the_gateways_own_vocabulary() {
        let entry = json!({
            "id": "cn:hy4-preview",
            "supports_images": true,
            "supports_reasoning": true,
            "reasoning_supported_efforts": ["high"],
            "reasoning_default_effort": "high",
        });

        let capabilities = EndpointModelCapabilities::from_models_entry(&entry);

        assert_eq!(capabilities.supports_vision, Some(true));
        assert_eq!(
            capabilities.reasoning_supported_efforts.as_deref(),
            Some(["high".to_string()].as_slice())
        );
        assert_eq!(capabilities.effort_levels(), vec![ThinkingEffort::High]);
        assert_eq!(capabilities.default_effort(), Some(ThinkingEffort::High));
        assert!(!capabilities.declares_nothing());
    }

    #[test]
    fn free_lane_entry_declares_nothing_but_is_still_listed() {
        let entry = json!({
            "id": "oc-space-bunny-free",
            "object": "model",
            "owned_by": "cortex-free-lane",
            "name": "OpenCode · Space Bunny Free",
            "context_window": 262144,
        });

        let capabilities = EndpointModelCapabilities::from_models_entry(&entry);

        assert!(capabilities.declares_nothing());
        assert_eq!(capabilities.effort_levels(), Vec::<ThinkingEffort>::new());
        assert_eq!(capabilities.word_for(ThinkingEffort::Max), None);
    }

    #[test]
    fn openrouter_input_modalities_stand_in_for_supports_images() {
        let entry = json!({
            "id": "some/model",
            "architecture": { "input_modalities": ["text", "image"] },
        });

        assert_eq!(
            EndpointModelCapabilities::from_models_entry(&entry).supports_vision,
            Some(true)
        );
        assert_eq!(
            EndpointModelCapabilities::from_models_entry(&json!({
                "id": "some/model",
                "architecture": { "input_modalities": ["text"] },
            }))
            .supports_vision,
            Some(false)
        );
    }

    #[test]
    fn max_maps_to_xhigh_and_back_through_the_declared_vocabulary() {
        let capabilities = EndpointModelCapabilities::from_models_entry(&json!({
            "id": "cn:space-bunny",
            "reasoning_supported_efforts": ["low", "medium", "high", "xhigh"],
        }));

        assert_eq!(
            capabilities.word_for(ThinkingEffort::Max).as_deref(),
            Some("xhigh")
        );
        assert_eq!(
            capabilities.effort_levels(),
            vec![
                ThinkingEffort::Low,
                ThinkingEffort::Medium,
                ThinkingEffort::High,
                ThinkingEffort::Max
            ]
        );
        assert_eq!(
            "xhigh".parse::<ThinkingEffort>().unwrap(),
            capabilities
                .word_for(ThinkingEffort::Max)
                .unwrap()
                .parse()
                .unwrap()
        );

        // Publishing both spellings must not make the answer depend on the order
        // the gateway listed them in.
        for listed in [
            vec!["max", "low", "xhigh"],
            vec!["low", "xhigh", "max"],
            vec!["xhigh", "max"],
        ] {
            let capabilities = EndpointModelCapabilities::from_models_entry(&json!({
                "id": "m",
                "reasoning_supported_efforts": listed,
            }));
            assert_eq!(
                capabilities.word_for(ThinkingEffort::Max).as_deref(),
                Some("max")
            );
        }
    }

    #[test]
    fn effort_levels_deduplicate_the_two_words_for_the_top_level() {
        let capabilities = EndpointModelCapabilities::from_models_entry(&json!({
            "id": "cn:space-bunny",
            "reasoning_supported_efforts": ["low", "medium", "high", "xhigh", "max"],
        }));

        assert_eq!(
            capabilities.effort_levels(),
            vec![
                ThinkingEffort::Low,
                ThinkingEffort::Medium,
                ThinkingEffort::High,
                ThinkingEffort::Max
            ]
        );
    }

    #[test]
    fn unparseable_effort_words_are_dropped_rather_than_forwarded() {
        let capabilities = EndpointModelCapabilities::from_models_entry(&json!({
            "id": "m",
            "reasoning_supported_efforts": ["low", "turbo", "high"],
        }));

        assert_eq!(
            capabilities.reasoning_supported_efforts.as_deref(),
            Some(["low".to_string(), "high".to_string()].as_slice())
        );
    }

    #[test]
    fn models_response_lookup_distinguishes_unlisted_from_undeclared() {
        let response = json!({ "data": [
            { "id": "cn:hy4-preview", "reasoning_supported_efforts": ["high"] },
            { "id": "oc-free", "object": "model" },
        ]});

        assert_eq!(
            from_models_response(&response, "cn:hy4-preview")
                .unwrap()
                .effort_levels(),
            vec![ThinkingEffort::High]
        );
        assert!(from_models_response(&response, "oc-free")
            .unwrap()
            .declares_nothing());
        assert!(from_models_response(&response, "not-listed").is_none());
    }

    #[test]
    fn probe_cache_keys_by_base_url_hash_and_model_and_survives_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model_capabilities.json");

        let cache = ProbeCache::load(path.clone());
        cache.record_vision("http://127.0.0.1:8787/v1/", "oc-free", false);
        cache.record_thinking_effort("http://127.0.0.1:8787/v1", "oc-free", false);
        cache.record_responses_api("http://127.0.0.1:8787/v1", false);
        cache.record_vision("http://127.0.0.1:9999/v1", "other", true);

        let reloaded = ProbeCache::load(path.clone());
        assert_eq!(
            reloaded.supports_vision("http://127.0.0.1:8787/v1", "oc-free"),
            Some(false)
        );
        assert_eq!(
            reloaded.supports_thinking_effort("http://127.0.0.1:8787/v1", "oc-free"),
            Some(false)
        );
        assert_eq!(
            reloaded.supports_responses_api("http://127.0.0.1:8787/v1"),
            Some(false)
        );
        assert_eq!(
            reloaded.supports_vision("http://127.0.0.1:9999/v1", "other"),
            Some(true),
            "a trailing slash must not fork the cache key"
        );
        assert_eq!(
            reloaded.supports_vision("http://127.0.0.1:8787/v1", "unknown"),
            None
        );
    }

    #[test]
    fn probe_cache_keeps_the_base_url_readable_next_to_its_hash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model_capabilities.json");
        ProbeCache::load(path.clone()).record_vision("http://127.0.0.1:8787/v1", "oc-free", false);

        let stored = read_probe_cache(&path).expect("cache file");
        assert_eq!(stored["version"], json!(CACHE_VERSION));
        let endpoint = stored["endpoints"][endpoint_key("http://127.0.0.1:8787/v1")].clone();
        assert_eq!(endpoint["base_url"], json!("http://127.0.0.1:8787/v1"));
        assert_eq!(
            endpoint["models"]["oc-free"]["supports_vision"]["supported"],
            json!(false)
        );
    }

    #[test]
    fn probe_cache_ignores_a_foreign_version_instead_of_trusting_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model_capabilities.json");
        let mut stale = cache_file();
        stale.version = CACHE_VERSION + 1;
        stale.endpoints.insert(
            endpoint_key("http://x/v1"),
            EndpointProbe {
                base_url: "http://x/v1".into(),
                supports_responses_api: Some(ProbeVerdict::now(false)),
                models: None,
            },
        );
        std::fs::write(&path, serde_json::to_vec(&stale).unwrap()).unwrap();

        assert_eq!(
            ProbeCache::load(path).supports_responses_api("http://x/v1"),
            None
        );
    }

    #[test]
    fn expired_probe_verdicts_are_re_probed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model_capabilities.json");
        ProbeCache::load(path.clone()).record_vision("http://x/v1", "m", false);

        let mut stored: ProbeCacheFile =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let probe = stored
            .endpoints
            .get_mut(&endpoint_key("http://x/v1"))
            .unwrap();
        probe
            .models
            .as_mut()
            .unwrap()
            .get_mut("m")
            .unwrap()
            .supports_vision = Some(ProbeVerdict {
            supported: false,
            checked_at: now_secs() - PROBE_TTL.as_secs() - 1,
        });
        std::fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();

        assert_eq!(
            ProbeCache::load(path).supports_vision("http://x/v1", "m"),
            None
        );
    }

    #[test]
    fn endpoint_key_is_stable_and_distinguishes_hosts_and_paths() {
        assert_eq!(endpoint_key("http://a/v1"), endpoint_key("http://a/v1/"));
        assert_ne!(endpoint_key("http://a/v1"), endpoint_key("http://b/v1"));
        assert_ne!(endpoint_key("http://a/v1"), endpoint_key("http://a/v2"));
        assert_eq!(endpoint_key("http://a/v1").len(), 16);
    }

    #[test]
    fn image_rejection_is_recognised() {
        assert_eq!(
            capability_rejection(&ProviderError::RequestFailed(
                "Bad request (400): this model does not support image input".into()
            )),
            Some(CapabilityRejection::Vision)
        );
        assert_eq!(
            capability_rejection(&ProviderError::RequestFailed(
                "Bad request (400): unsupported content type image_url".into()
            )),
            Some(CapabilityRejection::Vision)
        );
    }

    #[test]
    fn effort_rejection_is_recognised() {
        assert_eq!(
            capability_rejection(&ProviderError::RequestFailed(
                "Bad request (400): unrecognized request argument: reasoning_effort".into()
            )),
            Some(CapabilityRejection::ThinkingEffort)
        );
    }

    #[test]
    fn unrelated_and_size_related_bad_requests_are_not_capability_rejections() {
        assert_eq!(
            capability_rejection(&ProviderError::RequestFailed(
                "Bad request (400): model not found".into()
            )),
            None
        );
        assert_eq!(
            capability_rejection(&ProviderError::RequestFailed(
                "Bad request (400): image dimensions exceed maximum allowed size".into()
            )),
            None,
            "a size complaint must not strip images or skip the retry"
        );
        assert_eq!(
            capability_rejection(&ProviderError::Authentication("no key".into())),
            None
        );
    }

    #[test]
    fn missing_endpoint_recognises_the_responses_api_404() {
        assert!(is_missing_endpoint(&ProviderError::EndpointNotFound(
            "not found".into()
        )));
        assert!(is_missing_endpoint(&ProviderError::RequestFailed(
            "Resource not found (404) at http://x/v1/responses: {}".into()
        )));
        assert!(!is_missing_endpoint(&ProviderError::RequestFailed(
            "Bad request (400): model not found".into()
        )));
    }
}
