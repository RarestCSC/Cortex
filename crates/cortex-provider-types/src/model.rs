use crate::formats::openai::{
    extract_reasoning_effort, is_openai_responses_model, is_xai_reasoning_model,
    supports_xai_reasoning_effort,
};
use crate::thinking::ThinkingEffort;
use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub const DEFAULT_CONTEXT_LIMIT: usize = 128_000;

/// Request param keys that describe model-family-agnostic reasoning behavior and
/// are therefore safe to carry across a model switch or subagent delegation.
/// Provider-specific keys (e.g. `anthropic_beta`) are deliberately excluded so
/// they can't bleed into a request targeting a different model family.
const INHERITED_SESSION_PARAM_KEYS: &[&str] = &[
    "thinking_effort",
    "thinking_budget",
    "budget_tokens",
    "enable_thinking",
    "preserve_thinking_context",
    "preserve_unsigned_thinking",
];

/// Request params goose consumes itself: formats that forward unknown params into
/// the payload must skip these, or the provider gets an unrecognized wire parameter.
pub fn is_goose_internal_request_param(key: &str) -> bool {
    matches!(
        key,
        "thinking_effort"
            | "disable_prompt_cache"
            | "cache_ttl"
            | "emit_clear_thinking"
            | "preserve_thinking_context"
            | "preserve_unsigned_thinking"
    )
}

/// Reasoning models whose endpoint fixes the reasoning parameters, so goose has
/// no `reasoning_effort` knob to turn for them. Kept apart from
/// `is_reasoning_model`: that answers "does the model reason", this answers
/// "can the caller pick how hard it thinks".
fn reasoning_effort_is_fixed(model_name: &str) -> bool {
    is_xai_reasoning_model(model_name) && !supports_xai_reasoning_effort(model_name)
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelConfig {
    pub model_name: String,
    #[serde(skip)]
    pub context_limit: Option<usize>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub toolshim: bool,
    pub toolshim_model: Option<String>,
    /// Provider-specific request parameters (e.g., anthropic_beta headers)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_params: Option<HashMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
    /// What the endpoint itself said about this model. `None` means nobody
    /// asked; `Some` with every field `None` means the endpoint was asked and
    /// declared nothing, which is a different situation to act on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint_capabilities: Option<crate::endpoint_capabilities::EndpointModelCapabilities>,
    /// Per-request HTTP headers attached to outgoing provider calls.
    /// Never serialized into request bodies.
    #[serde(skip)]
    pub request_headers: Option<HashMap<String, String>>,
}

impl<'de> Deserialize<'de> for ModelConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RawModelConfig {
            model_name: String,
            #[serde(rename = "context_limit")]
            _context_limit: Option<usize>,
            temperature: Option<f32>,
            max_tokens: Option<i32>,
            toolshim: bool,
            toolshim_model: Option<String>,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            request_params: Option<HashMap<String, Value>>,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            reasoning: Option<bool>,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            supports_vision: Option<bool>,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            endpoint_capabilities: Option<crate::endpoint_capabilities::EndpointModelCapabilities>,
        }

        let raw = RawModelConfig::deserialize(deserializer)?;
        let mut config = Self {
            model_name: raw.model_name,
            context_limit: None,
            temperature: raw.temperature,
            max_tokens: raw.max_tokens,
            toolshim: raw.toolshim,
            toolshim_model: raw.toolshim_model,
            request_params: raw.request_params,
            reasoning: raw.reasoning,
            supports_vision: raw.supports_vision,
            endpoint_capabilities: raw.endpoint_capabilities,
            request_headers: None,
        };
        config.normalize_effort_suffix();
        Ok(config)
    }
}

fn levels_from_words(words: &[String]) -> Vec<ThinkingEffort> {
    let parsed: Vec<ThinkingEffort> = words
        .iter()
        .filter_map(|word| word.parse::<ThinkingEffort>().ok())
        .collect();
    [
        ThinkingEffort::Off,
        ThinkingEffort::Low,
        ThinkingEffort::Medium,
        ThinkingEffort::High,
        ThinkingEffort::Max,
    ]
    .into_iter()
    .filter(|effort| parsed.contains(effort))
    .collect()
}

fn word_for_words(words: &[String], effort: ThinkingEffort) -> Option<String> {
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

impl ModelConfig {
    pub fn new(model_name: impl AsRef<str>) -> Self {
        let mut config = Self {
            model_name: model_name.as_ref().to_string(),
            context_limit: None,
            temperature: None,
            max_tokens: None,
            toolshim: false,
            toolshim_model: None,
            request_params: None,
            reasoning: None,
            supports_vision: None,
            endpoint_capabilities: None,
            request_headers: None,
        };
        config.normalize_effort_suffix();
        config
    }

    fn canonical_model(&self, provider_name: &str) -> Option<crate::canonical::CanonicalModel> {
        // Try canonical lookup with the full model name first, then fall back
        // to the name with reasoning-effort suffixes stripped (e.g.
        // "databricks-gpt-5.4-high" → "databricks-gpt-5.4").
        crate::canonical::maybe_get_canonical_model(provider_name, &self.model_name).or_else(|| {
            let (base, _effort) = extract_reasoning_effort(&self.model_name);
            if base != self.model_name {
                crate::canonical::maybe_get_canonical_model(provider_name, &base)
            } else {
                None
            }
        })
    }

    pub fn with_canonical_vision_support(mut self, provider_name: &str) -> Self {
        if self.supports_vision.is_none() {
            if let Some(canonical) = self.canonical_model(provider_name) {
                self.supports_vision = Some(
                    canonical
                        .modalities
                        .input
                        .contains(&crate::canonical::Modality::Image),
                );
            }
        }
        self
    }

    pub fn with_canonical_limits(mut self, provider_name: &str) -> Self {
        let canonical = self.canonical_model(provider_name);

        if let Some(canonical) = canonical {
            if self.max_tokens.is_none() {
                self.max_tokens = canonical
                    .limit
                    .output
                    .filter(|&output| output < canonical.limit.context)
                    .map(|output| output as i32);
            }
            if self.reasoning.is_none() {
                self.reasoning = canonical.reasoning;
            }
            if self.supports_vision.is_none() {
                self.supports_vision = Some(
                    canonical
                        .modalities
                        .input
                        .contains(&crate::canonical::Modality::Image),
                )
            }
            if let Some(efforts) = canonical.reasoning_efforts.clone() {
                let capabilities = self
                    .endpoint_capabilities
                    .get_or_insert_with(Default::default);
                if capabilities.canonical_efforts.is_none() {
                    capabilities.canonical_efforts = Some(efforts);
                }
            }
        }

        self
    }

    /// Fill the input context window from the public catalog when nobody else
    /// supplied one. Kept separate from `with_canonical_limits`, which only
    /// fills output limits, reasoning, and vision.
    pub fn with_canonical_context_limit(mut self, provider_name: &str) -> Self {
        if self.context_limit.is_none() {
            if let Some(canonical) = self.canonical_model(provider_name) {
                self.context_limit = Some(canonical.limit.context);
            }
        }
        self
    }

    pub fn with_context_limit(mut self, limit: Option<usize>) -> Self {
        if limit.is_some() {
            self.context_limit = limit;
        }
        self
    }

    pub fn with_temperature(mut self, temp: Option<f32>) -> Self {
        self.temperature = temp;
        self
    }

    pub fn with_max_tokens(mut self, tokens: Option<i32>) -> Self {
        self.max_tokens = tokens;
        self
    }

    pub fn with_default_context_limit(mut self, limit: Option<usize>) -> Self {
        if self.context_limit.is_none() {
            self.context_limit = limit;
        }
        self
    }

    pub fn with_default_max_tokens(mut self, tokens: Option<i32>) -> Self {
        if self.max_tokens.is_none() {
            self.max_tokens = tokens;
        }
        self
    }

    pub fn with_toolshim(mut self, toolshim: bool) -> Self {
        self.toolshim = toolshim;
        self
    }

    pub fn with_toolshim_model(mut self, model: Option<String>) -> Self {
        self.toolshim_model = model;
        self
    }

    pub fn with_request_headers(mut self, headers: Option<HashMap<String, String>>) -> Self {
        self.request_headers = headers;
        self
    }

    pub fn with_merged_request_params(mut self, params: HashMap<String, Value>) -> Self {
        match self.request_params.as_mut() {
            Some(existing) => {
                for (k, v) in params {
                    existing.insert(k, v);
                }
            }
            None => {
                self.request_params = Some(params);
            }
        }
        self
    }

    pub fn with_thinking_effort(mut self, effort: ThinkingEffort) -> Self {
        let params = self.request_params.get_or_insert_with(HashMap::new);
        params.insert(
            "thinking_effort".to_string(),
            serde_json::json!(effort.to_string()),
        );
        self
    }

    pub fn with_default_thinking_effort(mut self, effort: Option<ThinkingEffort>) -> Self {
        // Guard on raw-param presence rather than parseability: a persisted
        // harness value like "default" doesn't parse into ThinkingEffort but
        // is still an explicit user pick that must not be overwritten.
        if self.request_param::<String>("thinking_effort").is_none() {
            if let Some(effort) = effort {
                self = self.with_thinking_effort(effort);
            }
        }
        self
    }

    pub fn with_vision_support(mut self, supports_vision: bool) -> Self {
        self.supports_vision = Some(supports_vision);
        self
    }

    /// Attach what the endpoint declared about this model.
    pub fn with_endpoint_capabilities(
        mut self,
        capabilities: crate::endpoint_capabilities::EndpointModelCapabilities,
    ) -> Self {
        self.endpoint_capabilities = Some(capabilities);
        self
    }

    /// What the endpoint declared, or `None` when nobody asked it.
    pub fn endpoint_capabilities(
        &self,
    ) -> Option<&crate::endpoint_capabilities::EndpointModelCapabilities> {
        self.endpoint_capabilities.as_ref()
    }

    /// True only when the endpoint was asked and answered with nothing. The
    /// distinction matters because a silent endpoint is a settings problem the
    /// user can fix, while an unasked one is just unknown.
    pub fn endpoint_declares_nothing(&self) -> bool {
        self.endpoint_capabilities
            .as_ref()
            .is_some_and(crate::endpoint_capabilities::EndpointModelCapabilities::declares_nothing)
    }

    /// The effort levels the endpoint declared, or an empty list when it
    /// declared no vocabulary.
    pub fn endpoint_effort_levels(&self) -> Vec<ThinkingEffort> {
        self.endpoint_capabilities
            .as_ref()
            .map(crate::endpoint_capabilities::EndpointModelCapabilities::effort_levels)
            .unwrap_or_default()
    }

    /// The level the endpoint runs at when the caller expresses no preference.
    pub fn endpoint_default_effort(&self) -> Option<ThinkingEffort> {
        self.endpoint_capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.default_effort())
    }

    /// The levels the menu should offer: the endpoint's own vocabulary first,
    /// then the canonical alias's vocabulary for silent relays.
    pub fn declared_effort_levels(&self) -> Vec<ThinkingEffort> {
        let endpoint = self.endpoint_effort_levels();
        if !endpoint.is_empty() {
            return endpoint;
        }
        self.endpoint_capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.canonical_efforts.as_deref())
            .map(levels_from_words)
            .unwrap_or_default()
    }

    /// Whether an `Off` stop can be honoured. The endpoint wins; a canonical
    /// vocabulary containing `none`/`off` is the fallback; silence keeps the
    /// historical behaviour (Off sends nothing).
    pub fn off_allowed(&self) -> bool {
        if let Some(capabilities) = self.endpoint_capabilities.as_ref() {
            if let Some(allowed) = capabilities.off_allowed() {
                return allowed;
            }
            // A relay that published levels but never mentioned disabling
            // thinking did not promise an Off stop. A completely silent relay
            // keeps the historical five-level menu, which includes Off.
            if capabilities.reasoning_supported_efforts.is_some()
                || capabilities.reasoning_effort.is_some()
            {
                return false;
            }
            if let Some(words) = capabilities.canonical_efforts.as_deref() {
                return words.iter().any(|word| {
                    word.eq_ignore_ascii_case("none") || word.eq_ignore_ascii_case("off")
                });
            }
        }
        // These families are always-on when the endpoint is silent; the menu
        // already uses a three-level fallback without Off for them.
        if self.is_glm_5_3_reasoning_model() || self.is_kimi_k3_reasoning_model() {
            return false;
        }
        true
    }

    /// The lowest level the menu offers. `default` maps here when `Off` is not
    /// available.
    pub fn lowest_effort(&self) -> Option<ThinkingEffort> {
        self.declared_effort_levels().first().copied()
    }

    /// The label for a level: the endpoint's actual word (`xhigh`) rather than
    /// Cortex's internal name (`max`), falling back to the internal name.
    pub fn effort_label(&self, effort: ThinkingEffort) -> String {
        if let Some(capabilities) = self.endpoint_capabilities.as_ref() {
            if let Some(label) = capabilities.effort_label(effort) {
                return label;
            }
            if let Some(words) = capabilities.canonical_efforts.as_deref() {
                if let Some(label) = word_for_words(words, effort) {
                    return label;
                }
            }
        }
        effort.to_string()
    }

    pub fn with_inherited_session_settings_from(
        mut self,
        previous: Option<&ModelConfig>,
        request_params: Option<HashMap<String, Value>>,
    ) -> Self {
        if let Some(previous_params) = previous.and_then(|p| p.request_params.as_ref()) {
            for key in INHERITED_SESSION_PARAM_KEYS {
                if let Some(value) = previous_params.get(*key) {
                    self.request_params
                        .get_or_insert_with(HashMap::new)
                        .entry(key.to_string())
                        .or_insert_with(|| value.clone());
                }
            }
        }

        if let Some(request_params) = request_params {
            self = self.with_merged_request_params(request_params);
        }

        self
    }

    pub fn context_limit(&self) -> usize {
        self.context_limit.unwrap_or(DEFAULT_CONTEXT_LIMIT)
    }

    pub fn is_openai_reasoning_model(&self) -> bool {
        self.openai_reasoning_for_model(&self.model_name)
    }

    pub fn openai_reasoning_for_model(&self, model_name: &str) -> bool {
        let canonical = crate::canonical::maybe_get_canonical_model("openai", model_name);
        if canonical
            .as_ref()
            .is_some_and(|model| !model.id.starts_with("openai/"))
        {
            return false;
        }
        self.reasoning
            .or_else(|| canonical.and_then(|model| model.reasoning))
            .unwrap_or_else(|| is_openai_responses_model(model_name))
    }

    pub fn is_reasoning_model(&self) -> bool {
        if let Some(reasoning) = self.reasoning {
            return reasoning;
        }

        self.is_openai_reasoning_model()
            || self.model_name.to_lowercase().contains("claude")
            || Self::is_gemini3_reasoning_model_name(&self.model_name)
            || self.is_glm_5_3_reasoning_model()
            || self.is_kimi_k3_reasoning_model()
            || is_xai_reasoning_model(&self.model_name)
    }

    /// True when the user's `ThinkingEffort` choice actually reaches the
    /// endpoint as a `reasoning_effort` on an OpenAI-compatible request.
    ///
    /// The effort menu and this predicate are two halves of one contract: a
    /// model offered more than one stop here must carry the picked value in the
    /// request body, otherwise the slider is decoration. Reasoning models whose
    /// endpoint fixes the reasoning parameters are excluded, because offering a
    /// knob there would be the same silent failure as offering none.
    pub fn sends_thinking_effort(&self) -> bool {
        self.is_reasoning_model() && !reasoning_effort_is_fixed(&self.model_name)
    }

    pub fn is_glm_5_3_reasoning_model(&self) -> bool {
        let name = self
            .model_name
            .splitn(3, '.')
            .nth(2)
            .unwrap_or(&self.model_name);
        let lower = name.to_lowercase();
        let segments: Vec<_> = lower
            .split(|character: char| !character.is_ascii_alphanumeric())
            .filter(|segment| !segment.is_empty())
            .collect();
        segments
            .windows(3)
            .any(|segments| segments == ["glm", "5", "3"])
    }

    pub fn is_kimi_k3_reasoning_model(&self) -> bool {
        let name = self
            .model_name
            .splitn(3, '.')
            .nth(2)
            .unwrap_or(&self.model_name);
        let lower = name.to_lowercase();
        let segments: Vec<_> = lower
            .split(|character: char| !character.is_ascii_alphanumeric())
            .filter(|segment| !segment.is_empty())
            .collect();
        segments
            .windows(2)
            .any(|segments| segments == ["kimi", "k3"])
    }

    fn is_gemini3_reasoning_model_name(model_name: &str) -> bool {
        let lower = model_name.to_lowercase();
        lower.starts_with("gemini-3") || lower.contains("/gemini-3") || lower.contains("-gemini-3")
    }

    pub fn max_output_tokens(&self) -> i32 {
        if let Some(tokens) = self.max_tokens {
            return tokens;
        }

        4_096
    }

    pub fn normalize_effort_suffix(&mut self) {
        if !is_openai_responses_model(&self.model_name)
            && !supports_xai_reasoning_effort(&self.model_name)
        {
            return;
        }
        let parts: Vec<&str> = self.model_name.split('-').collect();
        let last = match parts.last() {
            Some(l) => *l,
            None => return,
        };
        let effort = match last {
            "none" => ThinkingEffort::Off,
            "low" => ThinkingEffort::Low,
            "medium" => ThinkingEffort::Medium,
            "high" => ThinkingEffort::High,
            "xhigh" => ThinkingEffort::Max,
            _ => return,
        };
        self.model_name = parts[..parts.len() - 1].join("-");
        let has_explicit_effort = self
            .request_params
            .as_ref()
            .and_then(|p| p.get("thinking_effort"))
            .is_some();
        if !has_explicit_effort {
            let params = self.request_params.get_or_insert_with(HashMap::new);
            params.insert(
                "thinking_effort".to_string(),
                serde_json::json!(effort.to_string()),
            );
        }
    }

    pub fn thinking_effort(&self) -> Option<ThinkingEffort> {
        self.request_param::<String>("thinking_effort")
            .and_then(|s| s.parse::<ThinkingEffort>().ok())
    }

    pub fn with_prompt_cache_disabled(self) -> Self {
        self.with_merged_request_params(HashMap::from([(
            "disable_prompt_cache".to_string(),
            Value::Bool(true),
        )]))
    }

    pub fn prompt_cache_disabled(&self) -> bool {
        self.request_param::<bool>("disable_prompt_cache")
            .unwrap_or(false)
    }

    /// Set the prompt-cache TTL requested from providers that support one
    /// (currently the Anthropic message format). Valid values are "5m" and
    /// "1h"; absent means the provider default (5m).
    pub fn with_cache_ttl(self, ttl: &str) -> Self {
        self.with_merged_request_params(HashMap::from([(
            "cache_ttl".to_string(),
            Value::String(ttl.to_string()),
        )]))
    }

    /// Remove any prompt-cache TTL request parameter. The TTL is
    /// configuration state, not session state: callers that resume a
    /// persisted config drop the stored value and re-derive it from the
    /// current configuration so a clamped run never sticks to the session.
    pub fn without_cache_ttl(mut self) -> Self {
        if let Some(params) = self.request_params.as_mut() {
            params.remove("cache_ttl");
            if params.is_empty() {
                self.request_params = None;
            }
        }
        self
    }

    /// Clamp the prompt-cache TTL back to the provider default (5m).
    /// Burst-only surfaces (headless runs, subagents, scheduled recipes) call
    /// this so a user-level 1h opt-in never pays the 2x cache-write premium on
    /// workloads that finish in one burst and cannot idle.
    pub fn with_cache_ttl_clamped(self) -> Self {
        if self.cache_ttl().is_some_and(|ttl| ttl != "5m") {
            self.with_cache_ttl("5m")
        } else {
            self
        }
    }

    pub fn cache_ttl(&self) -> Option<String> {
        self.request_param::<String>("cache_ttl")
    }

    pub fn request_param<T: for<'de> serde::Deserialize<'de>>(
        &self,
        request_key: &str,
    ) -> Option<T> {
        self.request_params
            .as_ref()
            .and_then(|params| params.get(request_key))
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_ttl_round_trips_through_request_params() {
        let config = ModelConfig::new("claude-sonnet-4-5").with_cache_ttl("1h");
        assert_eq!(config.cache_ttl().as_deref(), Some("1h"));
        assert!(ModelConfig::new("claude-sonnet-4-5").cache_ttl().is_none());
    }

    #[test]
    fn cache_ttl_clamp_resets_one_hour_to_default() {
        let config = ModelConfig::new("claude-sonnet-4-5")
            .with_cache_ttl("1h")
            .with_cache_ttl_clamped();
        assert_eq!(config.cache_ttl().as_deref(), Some("5m"));
    }

    #[test]
    fn without_cache_ttl_removes_the_param_and_empty_map() {
        let config = ModelConfig::new("claude-sonnet-4-5")
            .with_cache_ttl("1h")
            .without_cache_ttl();
        assert!(config.cache_ttl().is_none());
        assert!(config.request_params.is_none());
    }

    #[test]
    fn without_cache_ttl_preserves_other_request_params() {
        let config = ModelConfig::new("claude-sonnet-4-5")
            .with_merged_request_params(HashMap::from([(
                "thinking_effort".to_string(),
                serde_json::json!("high"),
            )]))
            .with_cache_ttl("1h")
            .without_cache_ttl();
        assert!(config.cache_ttl().is_none());
        assert_eq!(
            config.request_param::<String>("thinking_effort").as_deref(),
            Some("high")
        );
    }

    #[test]
    fn cache_ttl_clamp_leaves_unset_ttl_absent() {
        let config = ModelConfig::new("claude-sonnet-4-5").with_cache_ttl_clamped();
        assert!(config.cache_ttl().is_none());
    }

    #[test]
    fn request_headers_never_serialize_into_bodies() {
        let config = ModelConfig::new("test-model").with_request_headers(Some(HashMap::from([(
            "queue_threshold".to_string(),
            "500".to_string(),
        )])));

        let serialized = serde_json::to_value(&config).unwrap();
        assert!(serialized.get("request_headers").is_none());
        assert_eq!(
            config
                .request_headers
                .as_ref()
                .unwrap()
                .get("queue_threshold"),
            Some(&"500".to_string())
        );
    }

    mod thinking_effort_tests {
        use super::*;

        fn config_with_params(model_name: &str, params: HashMap<String, Value>) -> ModelConfig {
            ModelConfig::new(model_name).with_merged_request_params(params)
        }

        #[test]
        fn from_request_params() {
            let mut params = HashMap::new();
            params.insert("thinking_effort".to_string(), serde_json::json!("medium"));
            let config = config_with_params("test", params);
            assert_eq!(config.thinking_effort(), Some(ThinkingEffort::Medium));
        }

        #[test]
        fn with_thinking_effort_sets_request_param() {
            let config = ModelConfig::new("test").with_thinking_effort(ThinkingEffort::High);

            assert_eq!(
                config
                    .request_params
                    .as_ref()
                    .and_then(|params| params.get("thinking_effort")),
                Some(&serde_json::json!("high"))
            );
        }

        #[test]
        fn with_default_thinking_effort_preserves_unparseable_raw_param() {
            let config = config_with_params(
                "test",
                HashMap::from([("thinking_effort".to_string(), serde_json::json!("default"))]),
            )
            .with_default_thinking_effort(Some(ThinkingEffort::High));

            assert_eq!(
                config
                    .request_params
                    .as_ref()
                    .and_then(|params| params.get("thinking_effort")),
                Some(&serde_json::json!("default"))
            );
        }

        #[test]
        fn with_default_thinking_effort_applies_when_absent() {
            let config =
                ModelConfig::new("test").with_default_thinking_effort(Some(ThinkingEffort::High));

            assert_eq!(config.thinking_effort(), Some(ThinkingEffort::High));
        }

        #[test]
        fn preserves_explicit_thinking_effort() {
            let previous = config_with_params(
                "previous",
                HashMap::from([("thinking_effort".to_string(), serde_json::json!("high"))]),
            );
            let config = ModelConfig::new("next")
                .with_inherited_session_settings_from(Some(&previous), None);

            assert_eq!(
                config
                    .request_params
                    .as_ref()
                    .and_then(|params| params.get("thinking_effort")),
                Some(&serde_json::json!("high"))
            );
        }

        #[test]
        fn does_not_override_existing_thinking_effort() {
            let previous = config_with_params(
                "previous",
                HashMap::from([("thinking_effort".to_string(), serde_json::json!("high"))]),
            );
            let config = config_with_params(
                "next",
                HashMap::from([("thinking_effort".to_string(), serde_json::json!("low"))]),
            )
            .with_inherited_session_settings_from(Some(&previous), None);

            assert_eq!(
                config
                    .request_params
                    .as_ref()
                    .and_then(|params| params.get("thinking_effort")),
                Some(&serde_json::json!("low"))
            );
        }

        #[test]
        fn inherits_reasoning_controls_but_not_provider_specific_params() {
            let previous = config_with_params(
                "previous",
                HashMap::from([
                    ("budget_tokens".to_string(), serde_json::json!(8192)),
                    (
                        "preserve_thinking_context".to_string(),
                        serde_json::json!(true),
                    ),
                    ("anthropic_beta".to_string(), serde_json::json!("beta")),
                ]),
            );
            let config = ModelConfig::new("next")
                .with_inherited_session_settings_from(Some(&previous), None);

            let params = config.request_params.expect("reasoning controls inherited");
            assert_eq!(params.get("budget_tokens"), Some(&serde_json::json!(8192)));
            assert_eq!(
                params.get("preserve_thinking_context"),
                Some(&serde_json::json!(true))
            );
            assert_eq!(params.get("anthropic_beta"), None);
        }

        #[test]
        fn explicit_request_params_override_preserved_session_settings() {
            let previous = config_with_params(
                "previous",
                HashMap::from([("thinking_effort".to_string(), serde_json::json!("high"))]),
            );
            let config = ModelConfig::new("next").with_inherited_session_settings_from(
                Some(&previous),
                Some(HashMap::from([(
                    "thinking_effort".to_string(),
                    serde_json::json!("low"),
                )])),
            );

            assert_eq!(
                config
                    .request_params
                    .as_ref()
                    .and_then(|params| params.get("thinking_effort")),
                Some(&serde_json::json!("low"))
            );
        }

        #[test]
        fn effort_suffix_stripped_from_model_name() {
            let _guard = env_lock::lock_env([
                ("GOOSE_THINKING_EFFORT", None::<&str>),
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_TEMPERATURE", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
                ("GOOSE_TOOLSHIM", None::<&str>),
                ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None::<&str>),
            ]);
            let config = ModelConfig::new("o3-mini-high");
            assert_eq!(config.model_name, "o3-mini");
            assert_eq!(config.thinking_effort(), Some(ThinkingEffort::High));
        }

        #[test]
        fn none_suffix_stripped_from_model_name() {
            let _guard = env_lock::lock_env([
                ("GOOSE_THINKING_EFFORT", Some("high")),
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_TEMPERATURE", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
                ("GOOSE_TOOLSHIM", None::<&str>),
                ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None::<&str>),
            ]);
            let config = ModelConfig::new("o3-mini-none");
            assert_eq!(config.model_name, "o3-mini");
            assert_eq!(config.thinking_effort(), Some(ThinkingEffort::Off));
        }

        #[test]
        fn xhigh_suffix_stripped_from_model_name() {
            let _guard = env_lock::lock_env([
                ("GOOSE_THINKING_EFFORT", Some("low")),
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_TEMPERATURE", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
                ("GOOSE_TOOLSHIM", None::<&str>),
                ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None::<&str>),
            ]);
            let config = ModelConfig::new("gpt-5.4-xhigh");
            assert_eq!(config.model_name, "gpt-5.4");
            assert_eq!(config.thinking_effort(), Some(ThinkingEffort::Max));
        }

        #[test]
        fn effort_suffix_not_stripped_when_thinking_effort_set() {
            let _guard = env_lock::lock_env([
                ("GOOSE_THINKING_EFFORT", None::<&str>),
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_TEMPERATURE", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
                ("GOOSE_TOOLSHIM", None::<&str>),
                ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None::<&str>),
            ]);
            let mut params = HashMap::new();
            params.insert("thinking_effort".to_string(), serde_json::json!("low"));
            let mut config = ModelConfig::new("o3-mini-high");
            // Suffix was already normalized during new(), but if request_params
            // were set before construction, the suffix would not be stripped.
            // Verify the normalized state:
            assert_eq!(config.model_name, "o3-mini");

            // Now simulate setting explicit effort after construction
            config.request_params = Some(params);
            assert_eq!(config.thinking_effort(), Some(ThinkingEffort::Low));
        }

        #[test]
        fn no_suffix_no_change() {
            let _guard = env_lock::lock_env([
                ("GOOSE_THINKING_EFFORT", None::<&str>),
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_TEMPERATURE", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
                ("GOOSE_TOOLSHIM", None::<&str>),
                ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None::<&str>),
            ]);
            let config = ModelConfig::new("o3-mini");
            assert_eq!(config.model_name, "o3-mini");
        }

        #[test]
        fn non_reasoning_model_suffix_not_stripped() {
            let _guard = env_lock::lock_env([
                ("GOOSE_THINKING_EFFORT", None::<&str>),
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_TEMPERATURE", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
                ("GOOSE_TOOLSHIM", None::<&str>),
                ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None::<&str>),
            ]);
            let config = ModelConfig::new("claude-sonnet-4-high");
            assert_eq!(config.model_name, "claude-sonnet-4-high");
        }

        #[test]
        fn xai_reasoning_effort_suffix_is_normalized() {
            let _guard = env_lock::lock_env([
                ("GOOSE_THINKING_EFFORT", None::<&str>),
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_TEMPERATURE", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
                ("GOOSE_TOOLSHIM", None::<&str>),
                ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None::<&str>),
            ]);
            let config = ModelConfig::new("grok-4.5-high");
            assert_eq!(config.model_name, "grok-4.5");
            assert_eq!(config.thinking_effort(), Some(ThinkingEffort::High));
        }

        #[test]
        fn parse_aliases() {
            assert_eq!("off".parse::<ThinkingEffort>(), Ok(ThinkingEffort::Off));
            assert_eq!(
                "disabled".parse::<ThinkingEffort>(),
                Ok(ThinkingEffort::Off)
            );
            assert_eq!("med".parse::<ThinkingEffort>(), Ok(ThinkingEffort::Medium));
            assert_eq!("max".parse::<ThinkingEffort>(), Ok(ThinkingEffort::Max));
            assert_eq!("xhigh".parse::<ThinkingEffort>(), Ok(ThinkingEffort::Max));
            assert!("invalid".parse::<ThinkingEffort>().is_err());
        }
    }

    mod supports_vision {
        use super::*;

        #[test]
        fn reads_supports_vision_from_config() {
            let config: ModelConfig = serde_json::from_str(
                r#"{"model_name":"gpt-4o","toolshim":false,"supports_vision":true}"#,
            )
            .unwrap();
            assert_eq!(config.supports_vision, Some(true));

            let config: ModelConfig = serde_json::from_str(
                r#"{"model_name":"gpt-4o","toolshim":false,"supports_vision":false}"#,
            )
            .unwrap();
            assert_eq!(config.supports_vision, Some(false));
        }

        #[test]
        fn defaults_supports_vision_to_none_when_absent() {
            let config: ModelConfig =
                serde_json::from_str(r#"{"model_name":"deepseek-v4","toolshim":false}"#).unwrap();
            assert_eq!(config.supports_vision, None);
        }

        #[test]
        fn serializes_supports_vision_only_when_some() {
            let config = ModelConfig::new("gpt-4o").with_vision_support(true);
            let serialized = serde_json::to_value(&config).unwrap();
            assert_eq!(
                serialized.get("supports_vision"),
                Some(&serde_json::Value::Bool(true))
            );

            let config = ModelConfig::new("deepseek-v4");
            let serialized = serde_json::to_value(&config).unwrap();
            assert!(serialized.get("supports_vision").is_none());
        }
    }

    mod with_canonical_limits {
        use super::*;

        #[test]
        fn sets_limits_from_canonical_model() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            let config = ModelConfig::new("gpt-4o").with_canonical_limits("openai");
            assert_eq!(config.max_tokens, Some(16_384));
            assert_eq!(config.reasoning, Some(false));
        }

        #[test]
        fn fills_context_limit_from_canonical_model() {
            let config = ModelConfig::new("gpt-6-luna").with_canonical_context_limit("openai");
            assert_eq!(config.context_limit, Some(1_050_000));
        }

        #[test]
        fn does_not_override_existing_context_limit() {
            let config = ModelConfig::new("gpt-6-luna")
                .with_context_limit(Some(200_000))
                .with_canonical_context_limit("openai");
            assert_eq!(config.context_limit, Some(200_000));
        }

        #[test]
        fn canonical_efforts_fill_a_silent_relay() {
            let config = ModelConfig::new("gpt-6-luna").with_canonical_limits("openai");
            assert_eq!(
                config.declared_effort_levels(),
                vec![
                    ThinkingEffort::Off,
                    ThinkingEffort::Low,
                    ThinkingEffort::Medium,
                    ThinkingEffort::High,
                    ThinkingEffort::Max,
                ]
            );
            assert!(config.off_allowed());
            assert_eq!(config.lowest_effort(), Some(ThinkingEffort::Off));
            assert_eq!(config.effort_label(ThinkingEffort::Max), "max");
        }

        #[test]
        fn canonical_efforts_without_off_hide_it() {
            let config = ModelConfig::new("gpt-6.1-sol").with_canonical_limits("openai");
            assert_eq!(
                config.declared_effort_levels(),
                vec![
                    ThinkingEffort::Low,
                    ThinkingEffort::Medium,
                    ThinkingEffort::High,
                    ThinkingEffort::Max,
                ]
            );
            assert!(!config.off_allowed());
            assert_eq!(config.lowest_effort(), Some(ThinkingEffort::Low));
        }

        #[test]
        fn does_not_override_existing_max_tokens() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            let mut config = ModelConfig::new("gpt-4o");
            config.max_tokens = Some(1_000);
            let config = config.with_canonical_limits("openai");

            assert_eq!(config.max_tokens, Some(1_000));
        }

        #[test]
        fn skips_canonical_output_limit_when_it_equals_context_limit() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            let config = ModelConfig::new("moonshotai/kimi-k2.6").with_canonical_limits("nvidia");
            assert_eq!(config.max_tokens, None);
            assert_eq!(config.max_output_tokens(), 4_096);
        }

        #[test]
        fn resolves_claude_sonnet_5_on_aws_bedrock() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            let config = ModelConfig::new("global.anthropic.claude-sonnet-5")
                .with_canonical_limits("aws_bedrock");
            assert_eq!(config.max_tokens, Some(128_000));
            assert_eq!(config.reasoning, Some(true));
        }

        #[test]
        fn unknown_model_leaves_fields_none() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            let config = ModelConfig::new("totally-unknown-model").with_canonical_limits("openai");

            assert_eq!(config.context_limit, None);
            assert_eq!(config.max_tokens, None);
            assert_eq!(config.reasoning, None);
        }

        #[test]
        fn resolves_after_stripping_reasoning_effort_suffix() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);

            // "gpt-5.6-sol-xhigh" should resolve via "gpt-5.6-sol"
            let config = ModelConfig::new("gpt-5.6-sol-xhigh").with_canonical_limits("openai");
            assert_eq!(config.max_tokens, Some(128_000));
            assert_eq!(config.reasoning, Some(true));
            let canonical = crate::canonical::maybe_get_canonical_model("openai", "gpt-5.6-sol")
                .expect("gpt-5.6-sol should have canonical metadata");
            assert_eq!(canonical.temperature, Some(false));

            let config = ModelConfig::new("gpt-5.6-sol").with_canonical_limits("chatgpt_codex");
            assert_eq!(config.max_tokens, Some(128_000));
            assert_eq!(config.reasoning, Some(true));
        }

        #[test]
        fn resolves_gpt_6_astra_limits_for_databricks_model_service() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            let config = ModelConfig::new("data_workflow_tools.goose.goose-gpt-6-astra")
                .with_canonical_limits("databricks_v2");

            let canonical = crate::canonical::maybe_get_canonical_model(
                "databricks_v2",
                "data_workflow_tools.goose.goose-gpt-6-astra",
            )
            .expect("GPT-6 Astra should have canonical metadata");
            assert_eq!(canonical.limit.context, 1_050_000);
            assert_eq!(canonical.limit.output, Some(128_000));
            assert_eq!(config.max_tokens, Some(128_000));
            assert_eq!(config.reasoning, Some(true));
            assert_eq!(config.supports_vision, Some(true));
        }

        #[test]
        fn fills_supports_vision_from_canonical_model() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            // gpt-4o is a vision model in the canonical catalog (image input modality).
            let config = ModelConfig::new("gpt-4o").with_canonical_limits("openai");
            assert_eq!(config.supports_vision, Some(true));
        }

        #[test]
        fn does_not_override_existing_supports_vision() {
            let _guard = env_lock::lock_env([
                ("GOOSE_MAX_TOKENS", None::<&str>),
                ("GOOSE_CONTEXT_LIMIT", None::<&str>),
            ]);
            let config = ModelConfig::new("gpt-4o")
                .with_vision_support(false)
                .with_canonical_limits("openai");
            assert_eq!(config.supports_vision, Some(false));
        }
    }

    mod is_openai_reasoning_model {
        use super::*;

        const ENV_LOCK_KEYS: [(&str, Option<&str>); 5] = [
            ("GOOSE_MAX_TOKENS", None),
            ("GOOSE_TEMPERATURE", None),
            ("GOOSE_CONTEXT_LIMIT", None),
            ("GOOSE_TOOLSHIM", None),
            ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None),
        ];

        #[test]
        fn uses_catalog_with_reasoning_family_fallback() {
            let _guard = env_lock::lock_env(ENV_LOCK_KEYS);
            assert!(ModelConfig::new("o3-mini").is_openai_reasoning_model());
            assert!(!ModelConfig::new("gpt-4o").is_openai_reasoning_model());
            assert!(ModelConfig::new("gpt-5-unknown-deployment").is_openai_reasoning_model());
            assert!(ModelConfig::new("o99-unknown").is_openai_reasoning_model());
            assert!(!ModelConfig::new("future-model").is_openai_reasoning_model());
        }

        #[test]
        fn explicit_reasoning_overrides_catalog_and_unknown_names() {
            let _guard = env_lock::lock_env(ENV_LOCK_KEYS);
            let mut config = ModelConfig::new("o3-mini");
            config.reasoning = Some(false);
            assert!(!config.is_openai_reasoning_model());
            config.model_name = "future-model".to_string();
            config.reasoning = Some(true);
            assert!(config.is_openai_reasoning_model());
            config.reasoning = Some(false);
            assert!(!config.is_openai_reasoning_model());
        }
    }

    mod is_reasoning_model {
        use super::*;

        const ENV_LOCK_KEYS: [(&str, Option<&str>); 5] = [
            ("GOOSE_MAX_TOKENS", None),
            ("GOOSE_TEMPERATURE", None),
            ("GOOSE_CONTEXT_LIMIT", None),
            ("GOOSE_TOOLSHIM", None),
            ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None),
        ];

        #[test]
        fn includes_reasoning_model_families() {
            let _guard = env_lock::lock_env(ENV_LOCK_KEYS);
            assert!(ModelConfig::new("o3-mini").is_reasoning_model());
            assert!(ModelConfig::new("claude-sonnet-4").is_reasoning_model());
            assert!(ModelConfig::new("gemini-3-pro").is_reasoning_model());
            assert!(ModelConfig::new("glm-5.3").is_reasoning_model());
            assert!(
                ModelConfig::new("data_workflow_tools.goose.goose-glm-5-3").is_reasoning_model()
            );
            assert!(!ModelConfig::new("glm-5.30").is_reasoning_model());
            assert!(!ModelConfig::new("glm_5_3_models.prod.llama-3").is_reasoning_model());
            assert!(ModelConfig::new("grok-4.5").is_reasoning_model());
            assert!(ModelConfig::new("grok-4.20-0309-reasoning").is_reasoning_model());
            assert!(!ModelConfig::new("grok-4.20-0309-non-reasoning").is_reasoning_model());
        }

        #[test]
        fn recognizes_kimi_k3_without_matching_other_versions() {
            for model in [
                "kimi-k3",
                "moonshotai/kimi-k3",
                "catalog.schema.goose-kimi-k3",
                "Kimi-K3",
            ] {
                assert!(ModelConfig::new(model).is_reasoning_model(), "{model}");
                let mut config = ModelConfig::new(model);
                config.reasoning = Some(false);
                assert!(!config.is_reasoning_model());
            }
            for model in ["kimi-k30", "kimi-k2.5", "kimi-k2-thinking", "notkimi-k3"] {
                assert!(
                    !ModelConfig::new(model).is_kimi_k3_reasoning_model(),
                    "{model}"
                );
            }
        }

        #[test]
        fn uses_explicit_metadata_first() {
            let _guard = env_lock::lock_env(ENV_LOCK_KEYS);
            let mut config = ModelConfig::new("provider-alias");
            config.reasoning = Some(true);
            assert!(config.is_reasoning_model());

            let mut config = ModelConfig::new("claude-sonnet-4");
            config.reasoning = Some(false);
            assert!(!config.is_reasoning_model());
        }
    }

    mod sends_thinking_effort {
        use super::*;

        const ENV_LOCK_KEYS: [(&str, Option<&str>); 5] = [
            ("GOOSE_MAX_TOKENS", None),
            ("GOOSE_TEMPERATURE", None),
            ("GOOSE_CONTEXT_LIMIT", None),
            ("GOOSE_TOOLSHIM", None),
            ("GOOSE_TOOLSHIM_OLLAMA_MODEL", None),
        ];

        #[test]
        fn follows_the_reasoning_families_the_effort_menu_offers() {
            let _guard = env_lock::lock_env(ENV_LOCK_KEYS);
            for model in [
                "gpt-5.4",
                "global:gpt-6-luna",
                "cn:glm-5.3-flash",
                "kimi-k3",
                "claude-sonnet-4",
                "gemini-3-pro",
                "grok-4.5",
            ] {
                assert!(ModelConfig::new(model).sends_thinking_effort(), "{model}");
            }
        }

        #[test]
        fn stays_off_for_models_without_a_knob() {
            let _guard = env_lock::lock_env(ENV_LOCK_KEYS);
            for model in [
                "gpt-4o",
                "future-model",
                "grok-4.20-0309-non-reasoning",
                // The endpoint fixes these models' reasoning parameters, so
                // goose would never send an effort for them.
                "grok-4.20-0309-reasoning",
                "grok-4-fast-reasoning",
            ] {
                assert!(!ModelConfig::new(model).sends_thinking_effort(), "{model}");
            }
        }

        #[test]
        fn follows_explicit_metadata() {
            let _guard = env_lock::lock_env(ENV_LOCK_KEYS);
            let mut config = ModelConfig::new("gateway-model");
            config.reasoning = Some(true);
            assert!(config.sends_thinking_effort());

            config.reasoning = Some(false);
            assert!(!config.sends_thinking_effort());
        }
    }
}
