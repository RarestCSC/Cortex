use super::api_client::ApiClient;
use super::base::{
    find_declared_model, known_models_from_registry, ConfigKey, ModelInfo, Provider,
    ProviderMetadata,
};
use super::retry::ProviderRetry;
use crate::api_client::{AuthMethod, TlsConfig};
use crate::conversation::message::Message;
use crate::conversation::token_usage::{CostSource, ProviderUsage};
use crate::declarative::{DeclarativeProviderConfig, KeyResolver};
use crate::endpoint_capabilities::{
    self, capability_rejection, from_models_response, is_missing_endpoint, publish_endpoint,
    CapabilityRejection, ProbeCache,
};
use crate::errors::ProviderError;
use crate::formats::openai::is_openai_responses_model;
use crate::formats::openai::{
    create_request_with_options, get_cost, get_usage, is_reserved_request_param_key,
    record_response_metadata, response_to_message, OpenAiFormatOptions,
};
use crate::formats::openai_responses::{
    create_responses_request_for_model, get_responses_usage, responses_api_to_message,
    ResponsesApiResponse,
};
use crate::http_status::read_json_response;
use crate::images::ImageFormat;
use crate::openai_compatible::{
    handle_response_openai_compat, handle_status, stream_openai_compat, stream_responses_compat,
};
use crate::request_log::{start_log, LoggerHandleExt, RequestLogHandle};
use crate::thinking::ThinkingEffort;
use anyhow::Result;
use async_trait::async_trait;
use reqwest::StatusCode;
use serde_json::json;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::OnceCell;

use crate::base::{MessageStream, ProviderDescriptor};
use crate::model::ModelConfig;
use rmcp::model::Tool;

pub const OPEN_AI_PROVIDER_NAME: &str = "openai";
pub const OPEN_AI_DEFAULT_BASE_PATH: &str = "v1/chat/completions";
pub const OPEN_AI_VERSIONLESS_BASE_PATH: &str = "chat/completions";
const OPEN_AI_DEFAULT_RESPONSES_PATH: &str = "v1/responses";
const OPEN_AI_DEFAULT_MODELS_PATH: &str = "v1/models";
const N_CTX_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const N_CTX_FAILURE_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy)]
enum CachedContextLimit {
    Success(Option<usize>),
    Failure(Instant),
}

impl CachedContextLimit {
    fn value(self) -> Option<Option<usize>> {
        match self {
            Self::Success(limit) => Some(limit),
            Self::Failure(fetched_at) if fetched_at.elapsed() < N_CTX_FAILURE_TTL => Some(None),
            Self::Failure(_) => None,
        }
    }
}
pub const OPEN_AI_DEFAULT_MODEL: &str = "gpt-6.1-sol";

pub const OPEN_AI_DOC_URL: &str = "https://platform.openai.com/docs/models";
const DEFAULT_TIMEOUT_SECONDS: u64 = 600;

type OpenAiBaseUrlParts = (String, Vec<(String, String)>, bool);

/// Ensure a base URL has an explicit scheme.
///
/// Users frequently enter hosts like `localhost:1234` without a scheme. The
/// `url` crate parses such input as `scheme="localhost"`, `path="1234"`,
/// silently dropping both the host and the port. When no `://` is present we
/// prepend a sensible scheme (`http://` for local hosts, `https://`
/// otherwise) so the host and port survive parsing.
pub fn ensure_url_scheme(raw_url: &str) -> String {
    let trimmed = raw_url.trim();
    if trimmed.contains("://") {
        return trimmed.to_string();
    }

    let host_part = trimmed.split(['/', '?']).next().unwrap_or(trimmed);
    let bare_host = if let Some(rest) = host_part.strip_prefix('[') {
        rest.split(']').next().unwrap_or(rest)
    } else {
        host_part.split(':').next().unwrap_or(host_part)
    };
    let is_local = bare_host == "localhost"
        || bare_host == "127.0.0.1"
        || bare_host == "0.0.0.0"
        || bare_host == "::1";

    let scheme = if is_local { "http" } else { "https" };
    format!("{}://{}", scheme, trimmed)
}

pub fn parse_openai_base_url(raw_url: &str) -> Result<OpenAiBaseUrlParts> {
    let raw_url = ensure_url_scheme(raw_url);
    let raw_url = raw_url.as_str();
    let parsed = url::Url::parse(raw_url)
        .map_err(|e| anyhow::anyhow!("Invalid OPENAI_BASE_URL '{}': {}", raw_url, e))?;

    let authority = parsed[..url::Position::BeforePath].to_string();
    let query_params: Vec<(String, String)> = parsed
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    let path = parsed.path().trim_end_matches('/');
    if path.is_empty() || path == "/" {
        return Ok((authority, query_params, true));
    }

    if path == "/v1" {
        return Ok((authority, query_params, true));
    }
    if let Some(prefix) = path.strip_suffix("/v1") {
        return Ok((format!("{}{}", authority, prefix), query_params, true));
    }

    Ok((format!("{}{}", authority, path), query_params, false))
}

#[derive(Debug, serde::Serialize)]
pub struct OpenAiProvider {
    #[serde(skip)]
    api_client: ApiClient,
    base_path: String,
    organization: Option<String>,
    project: Option<String>,
    custom_headers: Option<HashMap<String, String>>,
    supports_streaming: bool,
    name: String,
    custom_models: Option<Vec<ModelInfo>>,
    dynamic_models: Option<bool>,
    skip_canonical_filtering: bool,
    preserve_thinking_context: bool,
    native_openai: bool,
    #[serde(skip)]
    n_ctx_cache: Arc<Mutex<HashMap<String, CachedContextLimit>>>,
    /// Verdicts from endpoints that declare no capabilities. `None` disables
    /// probing entirely, which is the right default for tests and for callers
    /// outside the application.
    #[serde(skip)]
    capability_cache: Option<Arc<ProbeCache>>,
    /// Tri-state for "does this base_url serve the Responses API": `0`
    /// unprobed, `1` yes, `2` no. Seeded from the probe cache, so a gateway
    /// without it is not re-probed on every launch.
    #[serde(skip)]
    responses_api_support: Arc<AtomicU8>,
    /// Guards the one-shot `/v1/models` capability read per provider instance.
    #[serde(skip)]
    endpoint_capabilities_loaded: Arc<OnceCell<()>>,
    /// The public catalog provider this relay proxies, when the user declared
    /// one (`catalog_provider_id`). Used only as the canonical fallback after
    /// the endpoint's own metadata, never to override it.
    #[serde(skip)]
    canonical_provider: Option<String>,
}

/// How long to wait for `/v1/models` before giving up on capability metadata.
/// A capability read must never be the reason a request fails or hangs.
const CAPABILITY_FETCH_TIMEOUT: Duration = Duration::from_secs(5);

const RESPONSES_UNKNOWN: u8 = 0;
const RESPONSES_YES: u8 = 1;
const RESPONSES_NO: u8 = 2;

/// Stable identity for an endpoint in the probe cache: where requests actually
/// go, not the display URL the user typed.
fn endpoint_identity(host: &str, base_path: &str) -> String {
    format!(
        "{}/{}",
        host.trim_end_matches('/'),
        base_path.trim_start_matches('/')
    )
}

/// Builder for [`OpenAiProvider`].
///
/// Exposes every field of the provider so that constructors living outside
/// `openai.rs` (e.g. in `openai_def.rs`) can assemble a provider without
/// needing direct access to the struct's private fields.
pub struct OpenAiProviderBuilder {
    api_client: ApiClient,
    base_path: String,
    organization: Option<String>,
    project: Option<String>,
    custom_headers: Option<HashMap<String, String>>,
    supports_streaming: bool,
    name: String,
    custom_models: Option<Vec<ModelInfo>>,
    dynamic_models: Option<bool>,
    skip_canonical_filtering: bool,
    preserve_thinking_context: bool,
    native_openai: bool,
    capability_cache: Option<Arc<ProbeCache>>,
    canonical_provider: Option<String>,
}

impl OpenAiProviderBuilder {
    pub fn new(api_client: ApiClient) -> Self {
        Self {
            api_client,
            base_path: OPEN_AI_DEFAULT_BASE_PATH.to_string(),
            organization: None,
            project: None,
            custom_headers: None,
            supports_streaming: true,
            name: OPEN_AI_PROVIDER_NAME.to_string(),
            custom_models: None,
            dynamic_models: None,
            skip_canonical_filtering: false,
            preserve_thinking_context: false,
            native_openai: false,
            capability_cache: None,
            canonical_provider: None,
        }
    }

    pub fn api_client(mut self, api_client: ApiClient) -> Self {
        self.api_client = api_client;
        self
    }

    pub fn map_api_client(mut self, f: impl FnOnce(ApiClient) -> ApiClient) -> Self {
        self.api_client = f(self.api_client);
        self
    }

    pub fn try_map_api_client(
        mut self,
        f: impl FnOnce(ApiClient) -> Result<ApiClient>,
    ) -> Result<Self> {
        self.api_client = f(self.api_client)?;
        Ok(self)
    }

    pub fn base_path(mut self, base_path: impl Into<String>) -> Self {
        self.base_path = base_path.into();
        self
    }

    pub fn organization(mut self, organization: Option<String>) -> Self {
        self.organization = organization;
        self
    }

    pub fn project(mut self, project: Option<String>) -> Self {
        self.project = project;
        self
    }

    pub fn custom_headers(mut self, custom_headers: Option<HashMap<String, String>>) -> Self {
        self.custom_headers = custom_headers;
        self
    }

    pub fn supports_streaming(mut self, supports_streaming: bool) -> Self {
        self.supports_streaming = supports_streaming;
        self
    }

    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = name.into();
        self
    }

    pub fn custom_models(mut self, custom_models: Option<Vec<ModelInfo>>) -> Self {
        self.custom_models = custom_models;
        self
    }

    pub fn dynamic_models(mut self, dynamic_models: Option<bool>) -> Self {
        self.dynamic_models = dynamic_models;
        self
    }

    pub fn skip_canonical_filtering(mut self, skip_canonical_filtering: bool) -> Self {
        self.skip_canonical_filtering = skip_canonical_filtering;
        self
    }

    pub fn preserve_thinking_context(mut self, preserve_thinking_context: bool) -> Self {
        self.preserve_thinking_context = preserve_thinking_context;
        self
    }

    pub fn native_openai(mut self, native_openai: bool) -> Self {
        self.native_openai = native_openai;
        self
    }

    pub fn capability_cache(mut self, capability_cache: Option<Arc<ProbeCache>>) -> Self {
        self.capability_cache = capability_cache;
        self
    }

    pub fn canonical_provider(mut self, canonical_provider: Option<String>) -> Self {
        self.canonical_provider = canonical_provider;
        self
    }

    pub fn build(self) -> OpenAiProvider {
        let endpoint_identity = endpoint_identity(self.api_client.host(), &self.base_path);
        let responses_api_support = self
            .capability_cache
            .as_ref()
            .and_then(|cache| cache.supports_responses_api(&endpoint_identity))
            .map(|supported| {
                if supported {
                    RESPONSES_YES
                } else {
                    RESPONSES_NO
                }
            })
            .unwrap_or(RESPONSES_UNKNOWN);
        OpenAiProvider {
            api_client: self.api_client,
            base_path: self.base_path,
            organization: self.organization,
            project: self.project,
            custom_headers: self.custom_headers,
            supports_streaming: self.supports_streaming,
            name: self.name,
            custom_models: self.custom_models,
            dynamic_models: self.dynamic_models,
            skip_canonical_filtering: self.skip_canonical_filtering,
            preserve_thinking_context: self.preserve_thinking_context,
            native_openai: self.native_openai,
            n_ctx_cache: Arc::new(Mutex::new(HashMap::new())),
            capability_cache: self.capability_cache,
            responses_api_support: Arc::new(AtomicU8::new(responses_api_support)),
            endpoint_capabilities_loaded: Arc::new(OnceCell::new()),
            canonical_provider: self.canonical_provider,
        }
    }
}

impl OpenAiProvider {
    /// Fold freshly-read endpoint metadata into a `ModelConfig` that was built
    /// before the read happened.
    ///
    /// `ModelConfig` is materialized synchronously from a provider name, while
    /// `/v1/models` is an HTTP request, so on a cold start the config predates
    /// the metadata. Only the gaps are filled: a level already chosen — by the
    /// user, by the provider's model entry, or by the catalog — is never
    /// overwritten here.
    fn with_endpoint_capabilities<'a>(
        &self,
        model_config: &'a ModelConfig,
    ) -> Cow<'a, ModelConfig> {
        let mut capabilities =
            match endpoint_capabilities::lookup(&self.name, &model_config.model_name).endpoint {
                Some(capabilities) => capabilities,
                None => return Cow::Borrowed(model_config),
            };
        // `with_canonical_limits` may have stored the catalog vocabulary in the
        // previous capability record. Keep it when the endpoint's fresh record
        // replaces that record; the endpoint still wins on its own fields.
        if capabilities.canonical_efforts.is_none() {
            capabilities.canonical_efforts = model_config
                .endpoint_capabilities()
                .and_then(|old| old.canonical_efforts.clone());
        }
        let default_effort = if model_config.thinking_effort().is_none() {
            capabilities.default_effort()
        } else {
            None
        };
        // Mirror the reasoning rule `apply_declared_capabilities` runs at
        // construction. A cold start builds `ModelConfig` before `/v1/models`
        // has answered, so the endpoint's evidence has to be folded in here
        // too — otherwise the effort gate, which only reads `reasoning`, stays
        // closed for a model whose sole reasoning evidence is the endpoint.
        let reasoning = if model_config.reasoning.is_none() {
            capabilities.supports_reasoning.or_else(|| {
                (!capabilities.declares_nothing() && !capabilities.effort_levels().is_empty())
                    .then_some(true)
            })
        } else {
            None
        };
        // The relay is the authority for what it actually serves. Fill only
        // gaps: a user declaration or a canonical alias that already answered
        // stays untouched.
        let context_limit = if model_config.context_limit.is_none() {
            capabilities.context_window
        } else {
            None
        };
        let max_output_tokens = if model_config.max_tokens.is_none() {
            capabilities
                .max_output_tokens
                .and_then(|tokens| i32::try_from(tokens).ok())
        } else {
            None
        };
        // Always replace the record when the endpoint answered. A canonical-only
        // record (silent relay) must not short-circuit the endpoint's own
        // `supported_endpoint_types` or context fields.
        let mut enriched = model_config
            .clone()
            .with_endpoint_capabilities(capabilities);
        if let Some(effort) = default_effort {
            enriched = enriched.with_thinking_effort(effort);
        }
        if let Some(reasoning) = reasoning {
            enriched.reasoning = Some(reasoning);
        }
        if let Some(limit) = context_limit {
            enriched = enriched.with_default_context_limit(Some(limit));
        }
        if let Some(tokens) = max_output_tokens {
            enriched = enriched.with_default_max_tokens(Some(tokens));
        }
        Cow::Owned(enriched)
    }

    pub async fn stream_for_model(
        &self,
        model_config: &ModelConfig,
        wire_model: &str,
        capability_model: &str,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<MessageStream, ProviderError> {
        self.load_endpoint_capabilities().await;
        let enriched = self.with_endpoint_capabilities(model_config);
        let model_config = enriched.as_ref();

        let mut request_config = model_config.clone();
        request_config.supports_vision = self.vision_support(model_config);
        if self.native_openai && request_config.reasoning.is_none() {
            let canonical = cortex_provider_types::canonical::maybe_get_canonical_model(
                "openai",
                capability_model,
            );
            request_config.reasoning =
                Some(canonical.and_then(|model| model.reasoning).unwrap_or(true));
        }
        let mut payload = create_responses_request_for_model(
            &request_config,
            wire_model,
            capability_model,
            system,
            messages,
            tools,
        )?;
        payload["stream"] = serde_json::Value::Bool(self.supports_streaming);
        self.stream_responses_payload(model_config, payload).await
    }

    async fn stream_responses_payload(
        &self,
        model_config: &ModelConfig,
        payload: serde_json::Value,
    ) -> Result<MessageStream, ProviderError> {
        let mut log = start_log(model_config, &payload)?;
        let response = self
            .with_retry(|| async {
                handle_status(
                    self.api_client
                        .request(&Self::map_base_path(
                            &self.base_path,
                            "responses",
                            OPEN_AI_DEFAULT_RESPONSES_PATH,
                        ))
                        .model_headers(model_config)?
                        .streaming(self.supports_streaming)
                        .response_post(&payload)
                        .await?,
                )
                .await
            })
            .await
            .inspect_err(|e| {
                let _ = log.error(e);
            })?;
        if self.supports_streaming {
            stream_responses_compat(response, log)
        } else {
            let json: serde_json::Value = read_json_response(response).await?;
            let parsed: ResponsesApiResponse =
                serde_json::from_value(json.clone()).map_err(|e| {
                    ProviderError::ExecutionError(format!(
                        "Failed to parse responses API response: {}",
                        e
                    ))
                })?;
            let message = responses_api_to_message(&parsed)?;
            let usage_data = get_responses_usage(&parsed);
            let usage_json = json.get("usage").unwrap_or(&serde_json::Value::Null);
            let mut usage = ProviderUsage::new(model_config.model_name.clone(), usage_data);
            usage.response_id = Some(parsed.id.clone());
            let finish_reason = json
                .pointer("/incomplete_details/reason")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&parsed.status);
            usage.finish_reasons = Some(vec![finish_reason.to_string()]);
            if let Some(cost) = get_cost(usage_json) {
                usage = usage.with_cost(cost, CostSource::ProviderReported);
            }
            log.write(
                &serde_json::to_value(&message).unwrap_or_default(),
                Some(&usage_data),
            )?;
            Ok(super::base::stream_from_single_message(message, usage))
        }
    }

    #[doc(hidden)]
    pub fn new(api_client: ApiClient) -> Self {
        OpenAiProviderBuilder::new(api_client).build()
    }

    fn normalize_base_path(base_path: &str) -> String {
        if let Some(path) = base_path.strip_prefix('/') {
            format!("/{}", path.trim_end_matches('/'))
        } else {
            base_path.trim_end_matches('/').to_string()
        }
    }

    fn is_chat_completions_path(base_path: &str) -> bool {
        let normalized = Self::normalize_base_path(base_path).to_ascii_lowercase();
        normalized.contains("chat/completions")
    }

    fn is_responses_path(base_path: &str) -> bool {
        let normalized = Self::normalize_base_path(base_path).to_ascii_lowercase();
        normalized.ends_with("responses") || normalized.contains("/responses")
    }

    fn is_responses_model(model_name: &str) -> bool {
        is_openai_responses_model(model_name)
    }

    fn should_use_responses_api(model_name: &str, base_path: &str) -> bool {
        let normalized_base_path = Self::normalize_base_path(base_path);
        // Only the standard "v1/chat/completions" is treated as a default
        // path that defers to model-based routing.  The versionless
        // "chat/completions" (derived from an OPENAI_BASE_URL without /v1)
        // is treated as custom because versionless gateways typically do not
        // support the Responses API.
        let has_custom_base_path = normalized_base_path != OPEN_AI_DEFAULT_BASE_PATH;

        if has_custom_base_path {
            if Self::is_responses_path(&normalized_base_path) {
                return true;
            }
            if Self::is_chat_completions_path(&normalized_base_path) {
                return false;
            }
        }

        Self::is_responses_model(model_name)
    }

    /// Providers known to reject `max_completion_tokens` and require
    /// the legacy `max_tokens` field instead.
    const PROVIDERS_NEEDING_MAX_TOKENS_REMAP: &[&str] = &[
        "cerebras",
        "custom_deepseek",
        "groq",
        "inception",
        "kimi",
        "lmstudio",
        "mistral",
        "moonshot",
        "nearai",
        "ovhcloud",
    ];

    const PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS: &[&str] = &["nearai", "pleumrouter"];

    /// Providers whose endpoints require the non-standard `tool_stream`
    /// field to stream tool-call arguments incrementally.
    const PROVIDERS_NEEDING_TOOL_STREAM: &[&str] = &["zai_coding_plan"];

    /// Providers whose reasoning models accept an OpenAI-style
    /// `reasoning_effort` field on chat-completions requests but aren't
    /// matched by [`is_openai_responses_model`] (which only recognises
    /// OpenAI's own `o*`/`gpt-5*` model names). These need the unified
    /// [`ThinkingEffort`] mapped onto the request explicitly.
    const PROVIDERS_NEEDING_REASONING_EFFORT_MAPPING: &[&str] = &["meta"];

    /// Maps the unified thinking effort onto Meta's Muse Spark
    /// `reasoning_effort` levels: `low`, `medium`, `high`, `xhigh`.
    ///
    /// Muse Spark always reasons and has no supported "disable reasoning"
    /// level, so `Off` is clamped to `low` (the lightest level Meta
    /// supports) rather than sent as-is or omitted.
    fn meta_reasoning_effort(effort: ThinkingEffort) -> &'static str {
        match effort {
            ThinkingEffort::Off | ThinkingEffort::Low => "low",
            ThinkingEffort::Medium => "medium",
            ThinkingEffort::High => "high",
            ThinkingEffort::Max => "xhigh",
        }
    }

    fn declared_model(&self, model_name: &str) -> Option<&ModelInfo> {
        find_declared_model(self.custom_models.as_deref()?, model_name)
    }

    fn probe_cache(&self) -> Option<&ProbeCache> {
        self.capability_cache.as_deref()
    }

    /// Whether the endpoint is known to serve the Responses API. `None` until
    /// something has proven otherwise.
    fn responses_api_state(&self) -> u8 {
        self.responses_api_support.load(Ordering::Relaxed)
    }

    fn mark_responses_api(&self, supported: bool) {
        let state = if supported {
            RESPONSES_YES
        } else {
            RESPONSES_NO
        };
        if self.responses_api_support.swap(state, Ordering::Relaxed) == state {
            return;
        }
        if let Some(cache) = self.probe_cache() {
            cache.record_responses_api(
                &endpoint_identity(self.api_client.host(), &self.base_path),
                supported,
            );
        }
    }

    /// Whether to send images for this model.
    ///
    /// `None` means "nothing knows", and there the answer is optimistic: a
    /// gateway that never declared its capabilities should still be able to
    /// take a screenshot, and an endpoint that refuses says so in the request
    /// it rejects — which costs one error, not a token — so the optimistic path
    /// is cheaper than refusing preemptively on the user's behalf. The refusal
    /// is turned into a cached `false` by the caller.
    fn vision_support(&self, model_config: &ModelConfig) -> Option<bool> {
        let known = self
            .declared_model(&model_config.model_name)
            .and_then(|model| model.supports_vision)
            .or(model_config.supports_vision)
            .or_else(|| {
                self.probe_cache().and_then(|cache| {
                    cache.supports_vision(&self.endpoint_identity(), &model_config.model_name)
                })
            });
        known.or(Some(true))
    }

    fn endpoint_identity(&self) -> String {
        endpoint_identity(self.api_client.host(), &self.base_path)
    }

    /// Read `/v1/models` once per provider instance and publish whatever
    /// capability metadata it carries.
    ///
    /// Declarative providers only. A built-in provider's models are all in the
    /// catalog already, so asking would add one request per provider for
    /// metadata that is strictly worse than what it already has. Every failure
    /// mode — no endpoint, bad JSON, timeout, auth — leaves the registry as it
    /// was, which is the pre-B2 behaviour.
    async fn load_endpoint_capabilities(&self) {
        if self.custom_models.is_none() {
            return;
        }
        // `get_or_init` rather than `get_or_try_init`: an endpoint that has no
        // `/v1/models` would otherwise be re-probed on every single request.
        self.endpoint_capabilities_loaded
            .get_or_init(|| async {
                let _ = self.fetch_endpoint_capabilities().await;
            })
            .await;
    }

    async fn fetch_endpoint_capabilities(&self) -> Result<(), ProviderError> {
        let models_path =
            Self::map_base_path(&self.base_path, "models", OPEN_AI_DEFAULT_MODELS_PATH);
        let response = tokio::time::timeout(
            CAPABILITY_FETCH_TIMEOUT,
            self.api_client.request(&models_path).response_get(),
        )
        .await
        .map_err(|_| ProviderError::NetworkError("capability read timed out".to_string()))??;
        if response.status() == StatusCode::NOT_FOUND {
            return Err(ProviderError::EndpointNotFound(String::new()));
        }
        let body = read_json_response::<serde_json::Value>(handle_status(response).await?).await?;
        for model in self.custom_models.as_deref().unwrap_or_default() {
            if let Some(capabilities) = from_models_response(&body, &model.name) {
                publish_endpoint(&self.name, &model.name, capabilities);
            }
        }
        Ok(())
    }

    fn sanitize_request_for_compat(
        &self,
        mut payload: serde_json::Value,
        model_config: &ModelConfig,
    ) -> serde_json::Value {
        if let Some(obj) = payload.as_object_mut() {
            if Self::PROVIDERS_NEEDING_TOOL_STREAM.contains(&self.name.as_str())
                && obj.get("stream") == Some(&json!(true))
            {
                obj.entry("tool_stream").or_insert(json!(true));
            }

            if Self::PROVIDERS_NEEDING_MAX_TOKENS_REMAP.contains(&self.name.as_str()) {
                if let Some(value) = obj.remove("max_completion_tokens") {
                    obj.entry("max_tokens").or_insert(value);
                }
            }

            if Self::PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS.contains(&self.name.as_str()) {
                let model_name = obj.get("model").and_then(|model| model.as_str());
                if !model_name.is_some_and(Self::is_responses_model) {
                    obj.remove("reasoning_effort");
                }

                if let Some(messages) = obj.get_mut("messages").and_then(|m| m.as_array_mut()) {
                    for message in messages {
                        if message
                            .get("role")
                            .and_then(|role| role.as_str())
                            .is_some_and(|role| role == "developer")
                        {
                            message["role"] = serde_json::Value::String("system".to_string());
                        }
                    }
                }
            }

            if Self::PROVIDERS_NEEDING_REASONING_EFFORT_MAPPING.contains(&self.name.as_str()) {
                match model_config.thinking_effort() {
                    Some(effort) => {
                        obj.insert(
                            "reasoning_effort".to_string(),
                            json!(Self::meta_reasoning_effort(effort)),
                        );
                    }
                    None => {
                        obj.remove("reasoning_effort");
                    }
                }
            }
        }

        payload
    }

    fn should_use_responses_api_for_provider(&self, model_name: &str) -> bool {
        if Self::PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS.contains(&self.name.as_str()) {
            return false;
        }
        // Model-name routing says `gpt-6*` wants the Responses API. On a gateway
        // that only proxies `chat/completions` that answer is a 404, which
        // turns "the effort slider is unavailable" into "the model is
        // unavailable", so a proven-absent Responses API wins over the name.
        if self.responses_api_state() == RESPONSES_NO {
            return false;
        }
        // A relay that lists `openai-response` in `supported_endpoint_types`
        // answered the routing question directly. A negative answer also wins
        // over the model-name heuristic: `gpt-6*` on a chat-only relay is a
        // 404, not a capability the user can use.
        if let Some(capabilities) = endpoint_capabilities::lookup(&self.name, model_name).endpoint {
            match capabilities.supports_responses_api {
                Some(true) => return true,
                Some(false) => return false,
                None => {}
            }
        }

        let base_path = Self::normalize_base_path(&self.base_path);
        if self.native_openai && base_path == OPEN_AI_DEFAULT_BASE_PATH {
            return true;
        }
        Self::should_use_responses_api(model_name, &self.base_path)
    }

    fn map_base_path(base_path: &str, target: &str, fallback: &str) -> String {
        let normalized = Self::normalize_base_path(base_path);
        if normalized.ends_with(target) || normalized.contains(&format!("/{target}")) {
            return normalized;
        }

        if Self::is_chat_completions_path(&normalized) {
            return normalized.replacen("chat/completions", target, 1);
        }

        if Self::is_responses_path(&normalized) {
            return normalized.replacen("responses", target, 1);
        }

        if normalized.starts_with('/') {
            format!("/{}", fallback.trim_start_matches('/'))
        } else {
            fallback.to_string()
        }
    }

    async fn fetch_models_from_api(&self) -> Result<Vec<String>, ProviderError> {
        let models_path =
            Self::map_base_path(&self.base_path, "models", OPEN_AI_DEFAULT_MODELS_PATH);
        let response = self.api_client.request(&models_path).response_get().await?;

        if response.status() == StatusCode::NOT_FOUND {
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::EndpointNotFound(body));
        }

        let response = handle_status(response).await?;

        let body = response.bytes().await.map_err(|e| {
            ProviderError::NetworkError(format!("Failed to read response body: {}", e))
        })?;
        let json: serde_json::Value = serde_json::from_slice(&body).map_err(|e| {
            ProviderError::EndpointNotFound(format!("Response body is not valid JSON: {}", e))
        })?;

        if let Some(err_obj) = json.get("error").filter(|error| !error.is_null()) {
            let msg = err_obj
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(ProviderError::Authentication(msg.to_string()));
        }

        parse_model_ids(&json)
    }

    /// llama.cpp and Ollama expose the actual allocated context window in the
    /// non-standard `meta.n_ctx` field of `/v1/models`. Returns `None` when absent
    /// (e.g. real OpenAI).
    async fn fetch_n_ctx_from_api(&self, model_name: &str) -> Result<Option<usize>, ProviderError> {
        let models_path =
            Self::map_base_path(&self.base_path, "models", OPEN_AI_DEFAULT_MODELS_PATH);
        let response = self.api_client.request(&models_path).response_get().await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let json = handle_response_openai_compat(response).await.map_err(|error| {
            if matches!(&error, ProviderError::RequestFailed(message) if message.contains("not valid JSON")) {
                ProviderError::EndpointNotFound(error.to_string())
            } else {
                error
            }
        })?;
        Ok(parse_n_ctx_from_models(&json, model_name))
    }

    /// Build and send a `chat/completions` request.
    ///
    /// When `routing_fallback` is set the caller already learned that this
    /// endpoint has no Responses API, so the answer has to come from here — and
    /// the 400-downgrade loop must not run on top of it, because a model that
    /// was unreachable a moment ago is not the kind of mistake to answer by
    /// silently dropping the features the user asked for.
    async fn stream_chat(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
        routing_fallback: bool,
    ) -> Result<MessageStream, ProviderError> {
        let enriched = self.with_endpoint_capabilities(model_config);
        let model_config = enriched.as_ref();
        let mut send_vision = self.vision_support(model_config).unwrap_or_default();
        let mut send_effort = true;

        loop {
            let payload = self.build_chat_payload(
                model_config,
                system,
                messages,
                tools,
                send_vision,
                send_effort,
            )?;
            match self.post_chat(model_config, &payload).await {
                Ok((response, log)) => {
                    return self.read_chat_response(response, log, model_config).await
                }
                Err(error) => {
                    let refusal = match capability_rejection(&error) {
                        Some(refusal) => refusal,
                        None => return Err(error),
                    };
                    let downgrade = match refusal {
                        CapabilityRejection::Vision => {
                            // Refusing to strip images that were never sent, or
                            // from a model whose support was stated rather than
                            // assumed: the declaration is what needs correcting.
                            send_vision
                                && payload_carries_images(&payload)
                                && !routing_fallback
                                && self.vision_was_guessed(model_config)
                        }
                        CapabilityRejection::ThinkingEffort => {
                            send_effort
                                && payload.get("reasoning_effort").is_some()
                                && !routing_fallback
                                && self.effort_was_guessed(model_config)
                        }
                    };
                    if !downgrade {
                        return Err(error);
                    }
                    match refusal {
                        CapabilityRejection::Vision => {
                            send_vision = false;
                            if let Some(cache) = self.probe_cache() {
                                cache.record_vision(
                                    &self.endpoint_identity(),
                                    &model_config.model_name,
                                    false,
                                );
                            }
                        }
                        CapabilityRejection::ThinkingEffort => {
                            send_effort = false;
                            if let Some(cache) = self.probe_cache() {
                                cache.record_thinking_effort(
                                    &self.endpoint_identity(),
                                    &model_config.model_name,
                                    false,
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /// Whether image support was assumed rather than stated.
    ///
    /// A support the user declared or the endpoint published is never
    /// second-guessed on the strength of one error: the fix there is to correct
    /// the declaration, not to quietly ignore what was asked for.
    fn vision_was_guessed(&self, model_config: &ModelConfig) -> bool {
        self.declared_model(&model_config.model_name)
            .and_then(|model| model.supports_vision)
            .is_none()
            && model_config.supports_vision.is_none()
            && model_config
                .endpoint_capabilities
                .as_ref()
                .and_then(|capabilities| capabilities.supports_vision)
                .is_none()
    }

    /// Same rule as [`Self::vision_was_guessed`], for the effort knob.
    fn effort_was_guessed(&self, model_config: &ModelConfig) -> bool {
        self.declared_model(&model_config.model_name)
            .is_none_or(|model| !model.reasoning)
            && model_config
                .endpoint_capabilities
                .as_ref()
                .is_none_or(|capabilities| {
                    capabilities.supports_reasoning != Some(true)
                        && capabilities.effort_levels().is_empty()
                })
    }

    fn build_chat_payload(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
        supports_vision: bool,
        carry_effort: bool,
    ) -> Result<serde_json::Value, ProviderError> {
        let declared_model = self.declared_model(&model_config.model_name);
        let thinking_preservation_format =
            declared_model.and_then(|m| m.thinking_preservation_format);

        let mut payload = create_request_with_options(
            model_config,
            system,
            messages,
            tools,
            &ImageFormat::OpenAi,
            self.supports_streaming,
            OpenAiFormatOptions {
                preserve_thinking_context: self.preserve_thinking_context
                    || thinking_preservation_format.is_some(),
                supports_vision,
                thinking_preservation_format,
            },
        )?;

        if let Some(params) = declared_model.and_then(|m| m.request_params.as_ref()) {
            apply_declared_request_params(&mut payload, params);
        }
        if !carry_effort {
            if let Some(object) = payload.as_object_mut() {
                object.remove("reasoning_effort");
            }
        }

        Ok(self.sanitize_request_for_compat(payload, model_config))
    }

    async fn post_chat(
        &self,
        model_config: &ModelConfig,
        payload: &serde_json::Value,
    ) -> Result<(reqwest::Response, Option<Box<dyn RequestLogHandle>>), ProviderError> {
        let mut log = start_log(model_config, payload)?;
        let response = self
            .with_retry(|| async {
                let resp = self
                    .api_client
                    .request(&self.base_path)
                    .model_headers(model_config)?
                    .streaming(self.supports_streaming)
                    .response_post(payload)
                    .await?;
                handle_status(resp).await
            })
            .await
            .inspect_err(|e| {
                let _ = log.error(e);
            })?;
        Ok((response, log))
    }

    async fn read_chat_response(
        &self,
        response: reqwest::Response,
        mut log: Option<Box<dyn RequestLogHandle>>,
        model_config: &ModelConfig,
    ) -> Result<MessageStream, ProviderError> {
        if self.supports_streaming {
            return stream_openai_compat(response, log);
        }

        let json: serde_json::Value = read_json_response(response).await?;
        let message = response_to_message(&json)
            .map_err(|e| ProviderError::RequestFailed(format!("Failed to parse message: {}", e)))?;

        let usage_json = json.get("usage").unwrap_or(&serde_json::Value::Null);
        let usage_data = get_usage(usage_json);
        let mut usage = ProviderUsage::new(model_config.model_name.clone(), usage_data);
        record_response_metadata(&mut usage, &json);
        if let Some(cost) = get_cost(usage_json) {
            usage = usage.with_cost(cost, CostSource::ProviderReported);
        }

        log.write(
            &serde_json::to_value(&message).unwrap_or_default(),
            Some(&usage_data),
        )?;

        Ok(super::base::stream_from_single_message(message, usage))
    }
}

fn parse_model_ids(json: &serde_json::Value) -> Result<Vec<String>, ProviderError> {
    let models = json
        .get("data")
        .and_then(|value| value.as_array())
        .or_else(|| json.as_array())
        .ok_or_else(|| {
            ProviderError::RequestFailed("Missing models array in JSON response".into())
        })?;
    let mut model_ids: Vec<String> = models
        .iter()
        .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(str::to_string))
        .collect();
    model_ids.sort();
    Ok(model_ids)
}

/// Extract the context window for `model_name` from a `/v1/models` response
/// body: llama.cpp's `meta.n_ctx` first, then the relay's `context_length` /
/// `context_window` / `max_context_length`.
fn parse_n_ctx_from_models(json: &serde_json::Value, model_name: &str) -> Option<usize> {
    let data = json.get("data")?.as_array()?;

    // llama.cpp publishes `meta.n_ctx`; relays publish the same idea under
    // `context_length` (WorkBuddy) or `context_window` (free lane). Keep the
    // llama.cpp field first so its semantics do not change.
    let context_window = |entry: &serde_json::Value| -> Option<usize> {
        entry
            .get("meta")
            .and_then(|meta| meta.get("n_ctx"))
            .and_then(serde_json::Value::as_u64)
            .map(|v| v as usize)
            .or_else(|| {
                ["context_length", "context_window", "max_context_length"]
                    .iter()
                    .find_map(|key| entry.get(*key).and_then(serde_json::Value::as_u64))
                    .map(|v| v as usize)
            })
    };

    if let Some(entry) = data
        .iter()
        .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(model_name))
    {
        return context_window(entry);
    }

    // For single-model servers without --alias, llama.cpp reports the loaded model
    // file path as id rather than the client's alias, so no entry matches above.
    // Fall back to the sole entry's context window.
    match data.as_slice() {
        [only] => context_window(only),
        _ => None,
    }
}

impl ProviderDescriptor for OpenAiProvider {
    fn metadata() -> ProviderMetadata {
        ProviderMetadata::with_models(
            OPEN_AI_PROVIDER_NAME,
            "OpenAI",
            "OpenAI models, including OpenAI compatible ones",
            OPEN_AI_DEFAULT_MODEL,
            known_models_from_registry(OPEN_AI_PROVIDER_NAME),
            OPEN_AI_DOC_URL,
            vec![
                ConfigKey::new("OPENAI_API_KEY", false, true, None, true),
                ConfigKey::new("OPENAI_BASE_URL", false, false, None, false),
                ConfigKey::new(
                    "OPENAI_HOST",
                    true,
                    false,
                    Some("https://api.openai.com"),
                    false,
                ),
                ConfigKey::new("OPENAI_BASE_PATH", false, false, None, false),
                ConfigKey::new("OPENAI_ORGANIZATION", false, false, None, false),
                ConfigKey::new("OPENAI_PROJECT", false, false, None, false),
                ConfigKey::new("OPENAI_CUSTOM_HEADERS", false, true, None, false),
                ConfigKey::new("OPENAI_TIMEOUT", false, false, Some("600"), false),
            ],
        )
        .with_setup_steps(vec![
            "Go to https://platform.openai.com and sign up or log in",
            "Navigate to API Keys in the left sidebar",
            "Click 'Create new secret key'",
            "Copy the key and paste it above",
        ])
    }
}

#[async_trait]
impl Provider for OpenAiProvider {
    fn get_name(&self) -> &str {
        &self.name
    }

    async fn refresh_credentials(&self) -> Result<(), ProviderError> {
        self.api_client
            .refresh_credentials()
            .await
            .map_err(|error| ProviderError::Authentication(error.to_string()))
    }

    fn skip_canonical_filtering(&self) -> bool {
        self.skip_canonical_filtering
    }

    async fn get_context_limit(&self, model: &str, override_limit: Option<usize>) -> usize {
        let configured_limits = self
            .custom_models
            .iter()
            .flatten()
            .filter_map(|model| model.context_limit.map(|limit| (model.name.clone(), limit)));
        let canonical_provider = self.canonical_provider.as_deref().unwrap_or(&self.name);
        let resolver =
            cortex_provider_types::context_limit::ContextLimitResolver::new(canonical_provider)
                .with_configured_limits(configured_limits);

        resolver
            .resolve(model, override_limit, || async {
                if let Some(cached) = self
                    .n_ctx_cache
                    .lock()
                    .ok()
                    .and_then(|cache| cache.get(model).copied())
                    .and_then(CachedContextLimit::value)
                {
                    return Ok(cached);
                }

                let probed = match tokio::time::timeout(
                    N_CTX_PROBE_TIMEOUT,
                    self.fetch_n_ctx_from_api(model),
                )
                .await
                {
                    Ok(Ok(limit)) => Ok(limit),
                    Ok(Err(error)) if error.is_endpoint_not_found() => Ok(None),
                    Ok(Err(error)) => Err(error),
                    Err(_) => Err(ProviderError::RequestFailed(
                        "Context-limit discovery timed out".into(),
                    )),
                };

                if let Ok(mut cache) = self.n_ctx_cache.lock() {
                    let cached = match probed.as_ref() {
                        Ok(limit) => CachedContextLimit::Success(*limit),
                        Err(_) => CachedContextLimit::Failure(Instant::now()),
                    };
                    cache.insert(model.to_string(), cached);
                }
                probed
            })
            .await
    }

    async fn fetch_supported_models(&self) -> Result<Vec<String>, ProviderError> {
        if let Some(custom_models) = &self.custom_models {
            let names: Vec<String> = custom_models.iter().map(|m| m.name.clone()).collect();
            if self.dynamic_models == Some(false) {
                return Ok(names);
            }
            match self.fetch_models_from_api().await {
                Ok(models) => return Ok(models),
                Err(e) if e.is_endpoint_not_found() => {
                    tracing::debug!(
                        "Models endpoint not implemented for provider '{}' ({}), using predefined list",
                        self.name,
                        e
                    );
                    return Ok(names);
                }
                Err(e) => return Err(e),
            }
        }

        self.fetch_models_from_api().await
    }

    async fn fetch_supported_model_info(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let names = self.fetch_supported_models().await?;
        Ok(crate::base::merge_configured_model_info(
            &self.name,
            &names,
            self.custom_models.as_deref().unwrap_or_default(),
        ))
    }

    async fn stream(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<MessageStream, ProviderError> {
        self.load_endpoint_capabilities().await;

        if self.should_use_responses_api_for_provider(&model_config.model_name) {
            let (wire_model, _) =
                crate::formats::openai::extract_reasoning_effort(&model_config.model_name);
            match self
                .stream_for_model(
                    model_config,
                    &wire_model,
                    &model_config.model_name,
                    system,
                    messages,
                    tools,
                )
                .await
            {
                Err(error) if is_missing_endpoint(&error) => {
                    // The endpoint answered "no such path" for `/v1/responses`.
                    // Remember it so routing stops asking, then answer the same
                    // call over chat completions, which is the API every
                    // OpenAI-compatible gateway implements.
                    self.mark_responses_api(false);
                    self.stream_chat(model_config, system, messages, tools, true)
                        .await
                }
                result => {
                    self.mark_responses_api(true);
                    result
                }
            }
        } else {
            self.stream_chat(model_config, system, messages, tools, false)
                .await
        }
    }
}

/// Whether a built payload actually contains image parts, so that an image
/// refusal cannot strip something that was never sent.
fn payload_carries_images(payload: &serde_json::Value) -> bool {
    payload
        .get("messages")
        .and_then(|messages| messages.as_array())
        .is_some_and(|messages| {
            messages.iter().any(|message| {
                message
                    .get("content")
                    .and_then(|content| content.as_array())
                    .is_some_and(|parts| {
                        parts.iter().any(|part| {
                            part.get("type").and_then(|kind| kind.as_str()) == Some("image_url")
                        })
                    })
            })
        })
}

/// Merges a model's declared `request_params` into an already-built payload.
///
/// Reserved keys are skipped so a declaration cannot clobber the streaming setup.
fn apply_declared_request_params(
    payload: &mut serde_json::Value,
    params: &HashMap<String, serde_json::Value>,
) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };

    for (key, value) in params {
        if !is_reserved_request_param_key(key) {
            object.insert(key.clone(), value.clone());
        }
    }
}

pub fn from_declarative_config(
    config: DeclarativeProviderConfig,
    tls_config: Option<TlsConfig>,
    key_resolver: impl KeyResolver,
) -> Result<OpenAiProviderBuilder> {
    let custom_models = if !config.models.is_empty() {
        Some(config.models.clone())
    } else {
        None
    };

    if config.dynamic_models == Some(false) && custom_models.is_none() {
        return Err(anyhow::anyhow!(
            "Provider '{}' has dynamic_models: false but no static models listed; \
             at least one entry in `models` is required.",
            config.name
        ));
    }

    config.validate_auth()?;

    let api_key = if config.api_key_env.is_empty() {
        None
    } else {
        match key_resolver.resolve_key(config.api_key_env.as_str()) {
            Ok(key) => Some(key),
            Err(err) => {
                if config.requires_auth {
                    anyhow::bail!("missing required key {}: {}", config.api_key_env, err);
                }
                None
            }
        }
    };

    let normalized_base_url = ensure_url_scheme(&config.base_url);
    let url = url::Url::parse(&normalized_base_url)
        .map_err(|e| anyhow::anyhow!("Invalid base URL '{}': {}", config.base_url, e))?;

    let host = url[..url::Position::BeforePath].to_string();
    let base_path = if let Some(ref explicit_path) = config.base_path {
        explicit_path.trim_start_matches('/').to_string()
    } else {
        derive_base_path(url.path())
    };

    let timeout_secs = config.timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECONDS);

    let auth = match api_key {
        Some(key) if !key.is_empty() => AuthMethod::BearerToken(key),
        _ => AuthMethod::NoAuth,
    };
    let mut api_client = ApiClient::with_timeout_and_tls(
        host,
        auth,
        std::time::Duration::from_secs(timeout_secs),
        tls_config,
    )?;

    if let Some(query) = url.query() {
        let query_params = url::form_urlencoded::parse(query.as_bytes())
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        api_client = api_client.with_query(query_params);
    }

    if let Some(headers) = &config.headers {
        let mut header_map = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            let header_name = reqwest::header::HeaderName::from_bytes(key.as_bytes())?;
            let header_value = reqwest::header::HeaderValue::from_str(value)?;
            header_map.insert(header_name, header_value);
        }
        api_client = api_client.with_headers(header_map)?;
    }

    Ok(OpenAiProviderBuilder::new(api_client)
        .base_path(base_path)
        .custom_headers(config.headers)
        .supports_streaming(config.supports_streaming.unwrap_or(true))
        .name(config.name.clone())
        .custom_models(custom_models)
        .dynamic_models(config.dynamic_models)
        .skip_canonical_filtering(config.skip_canonical_filtering)
        .preserve_thinking_context(config.preserves_thinking)
        .canonical_provider(config.catalog_provider_id))
}

pub fn parse_custom_headers(s: String) -> HashMap<String, String> {
    s.split(',')
        .filter_map(|header| {
            let mut parts = header.splitn(2, '=');
            let key = parts.next().map(|s| s.trim().to_string())?;
            let value = parts.next().map(|s| s.trim().to_string())?;
            Some((key, value))
        })
        .collect()
}

pub fn derive_base_path(url_path: &str) -> String {
    let stripped = url_path.trim_start_matches('/');
    let normalized = stripped.trim_end_matches('/');
    if normalized.is_empty() {
        "v1/chat/completions".to_string()
    } else if normalized.ends_with("chat/completions") {
        stripped.to_string()
    } else if ends_with_version_segment(normalized) {
        format!("{}/chat/completions", normalized)
    } else {
        format!("{}/v1/chat/completions", normalized)
    }
}

fn ends_with_version_segment(path: &str) -> bool {
    let last = path.rsplit('/').next().unwrap_or(path);
    last.strip_prefix('v')
        .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api_client::AuthMethod;
    use crate::endpoint_capabilities;
    use futures::StreamExt;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_provider(name: &str) -> OpenAiProvider {
        OpenAiProvider {
            api_client: ApiClient::new_with_tls(
                "http://localhost".to_string(),
                AuthMethod::NoAuth,
                None,
            )
            .unwrap(),
            base_path: "v1/chat/completions".to_string(),
            organization: None,
            project: None,
            custom_headers: None,
            supports_streaming: true,
            name: name.to_string(),
            custom_models: None,
            dynamic_models: None,
            skip_canonical_filtering: false,
            preserve_thinking_context: false,
            native_openai: false,
            n_ctx_cache: Arc::new(Mutex::new(HashMap::new())),
            capability_cache: None,
            responses_api_support: Arc::new(AtomicU8::new(RESPONSES_UNKNOWN)),
            endpoint_capabilities_loaded: Arc::new(OnceCell::new()),
            canonical_provider: None,
        }
    }

    #[test]
    fn coding_plan_tool_stream_is_scoped_and_preserves_explicit_overrides() {
        let model = ModelConfig::new("glm-future");
        for (provider, payload, expected) in [
            (
                "zai_coding_plan",
                json!({"stream": true}),
                Some(json!(true)),
            ),
            ("zai_coding_plan", json!({"stream": false}), None),
            ("openai", json!({"stream": true}), None),
            (
                "zai_coding_plan",
                json!({"stream": true, "tool_stream": false}),
                Some(json!(false)),
            ),
        ] {
            let request = make_provider(provider).sanitize_request_for_compat(payload, &model);
            assert_eq!(request.get("tool_stream"), expected.as_ref());
        }
    }

    #[test]
    fn sanitize_remaps_max_completion_tokens_for_compat_provider() {
        let provider = make_provider("mistral");
        let payload = json!({
            "model": "mistral-medium-latest",
            "messages": [],
            "max_completion_tokens": 16384
        });

        let result = provider
            .sanitize_request_for_compat(payload, &ModelConfig::new("mistral-medium-latest"));
        let obj = result.as_object().unwrap();

        assert!(!obj.contains_key("max_completion_tokens"));
        assert_eq!(obj.get("max_tokens").unwrap(), &json!(16384));
    }

    #[test]
    fn sanitize_preserves_existing_max_tokens_for_compat_provider() {
        let provider = make_provider("mistral");
        let payload = json!({
            "model": "mistral-medium-latest",
            "messages": [],
            "max_tokens": 4096,
            "max_completion_tokens": 16384
        });

        let result = provider
            .sanitize_request_for_compat(payload, &ModelConfig::new("mistral-medium-latest"));
        let obj = result.as_object().unwrap();

        assert!(!obj.contains_key("max_completion_tokens"));
        assert_eq!(obj.get("max_tokens").unwrap(), &json!(4096));
    }

    #[test]
    fn sanitize_noop_for_native_openai_provider() {
        let provider = make_provider("openai");
        let payload = json!({
            "model": "o3",
            "messages": [],
            "max_completion_tokens": 16384
        });

        let result = provider.sanitize_request_for_compat(payload, &ModelConfig::new("o3"));
        let obj = result.as_object().unwrap();

        assert!(obj.contains_key("max_completion_tokens"));
        assert!(!obj.contains_key("max_tokens"));
    }

    #[test]
    fn sanitize_noop_for_unknown_provider() {
        let provider = make_provider("some_future_provider");
        let payload = json!({
            "model": "future-model",
            "messages": [],
            "max_completion_tokens": 16384
        });

        let result =
            provider.sanitize_request_for_compat(payload, &ModelConfig::new("future-model"));
        let obj = result.as_object().unwrap();

        assert!(obj.contains_key("max_completion_tokens"));
        assert!(!obj.contains_key("max_tokens"));
    }

    #[test]
    fn sanitize_no_token_params() {
        let provider = make_provider("groq");
        let payload = json!({
            "model": "llama-3.3-70b-versatile",
            "messages": []
        });

        let result = provider.sanitize_request_for_compat(
            payload.clone(),
            &ModelConfig::new("llama-3.3-70b-versatile"),
        );
        assert_eq!(result, payload);
    }

    #[test]
    fn sanitize_nearai_reasoning_chat_params() {
        let provider = make_provider("nearai");
        let payload = json!({
            "model": "Qwen/Qwen3.6-35B-A3B-FP8",
            "messages": [
                {
                    "role": "developer",
                    "content": "system instructions"
                },
                {
                    "role": "user",
                    "content": "hello"
                }
            ],
            "reasoning_effort": "medium",
            "max_completion_tokens": 16384
        });

        let result = provider
            .sanitize_request_for_compat(payload, &ModelConfig::new("Qwen/Qwen3.6-35B-A3B-FP8"));
        let obj = result.as_object().unwrap();

        assert!(!obj.contains_key("reasoning_effort"));
        assert!(!obj.contains_key("max_completion_tokens"));
        assert_eq!(obj.get("max_tokens").unwrap(), &json!(16384));
        assert_eq!(obj["messages"][0]["role"], "system");
        assert_eq!(obj["messages"][1]["role"], "user");
    }

    #[test]
    fn sanitize_nearai_preserves_openai_reasoning_effort() {
        let provider = make_provider("nearai");
        let payload = json!({
            "model": "openai/gpt-5",
            "messages": [],
            "reasoning_effort": "medium",
            "max_completion_tokens": 16384
        });

        let result =
            provider.sanitize_request_for_compat(payload, &ModelConfig::new("openai/gpt-5"));
        let obj = result.as_object().unwrap();

        assert_eq!(obj.get("reasoning_effort"), Some(&json!("medium")));
        assert!(!obj.contains_key("max_completion_tokens"));
        assert_eq!(obj.get("max_tokens").unwrap(), &json!(16384));
    }

    #[test]
    fn sanitize_meta_applies_reasoning_effort_from_thinking_effort() {
        let provider = make_provider("meta");
        let payload = json!({
            "model": "muse-spark-1.1",
            "messages": []
        });
        let model_config =
            ModelConfig::new("muse-spark-1.1").with_thinking_effort(ThinkingEffort::High);

        let result = provider.sanitize_request_for_compat(payload, &model_config);
        let obj = result.as_object().unwrap();

        assert_eq!(obj.get("reasoning_effort"), Some(&json!("high")));
    }

    #[test]
    fn sanitize_meta_maps_max_thinking_effort_to_xhigh() {
        let provider = make_provider("meta");
        let payload = json!({
            "model": "muse-spark-1.1",
            "messages": []
        });
        let model_config =
            ModelConfig::new("muse-spark-1.1").with_thinking_effort(ThinkingEffort::Max);

        let result = provider.sanitize_request_for_compat(payload, &model_config);
        let obj = result.as_object().unwrap();

        assert_eq!(obj.get("reasoning_effort"), Some(&json!("xhigh")));
    }

    #[test]
    fn sanitize_meta_clamps_off_thinking_effort_to_low() {
        // Muse Spark always reasons and has no "disable reasoning" level,
        // so an explicit `Off` must be clamped to the lightest supported
        // level rather than omitted or sent as-is.
        let provider = make_provider("meta");
        let payload = json!({
            "model": "muse-spark-1.1",
            "messages": [],
            "reasoning_effort": "high"
        });
        let model_config =
            ModelConfig::new("muse-spark-1.1").with_thinking_effort(ThinkingEffort::Off);

        let result = provider.sanitize_request_for_compat(payload, &model_config);
        let obj = result.as_object().unwrap();

        assert_eq!(obj.get("reasoning_effort"), Some(&json!("low")));
    }

    #[test]
    fn sanitize_meta_omits_reasoning_effort_when_unset() {
        let provider = make_provider("meta");
        let payload = json!({
            "model": "muse-spark-1.1",
            "messages": []
        });
        let model_config = ModelConfig::new("muse-spark-1.1");

        let result = provider.sanitize_request_for_compat(payload, &model_config);
        let obj = result.as_object().unwrap();

        assert!(!obj.contains_key("reasoning_effort"));
    }

    #[test]
    fn nearai_uses_chat_completions_for_openai_reasoning_models() {
        let provider = make_provider("nearai");

        assert!(!provider.should_use_responses_api_for_provider("openai/gpt-5"));
        assert!(!provider.should_use_responses_api_for_provider("openai/o3"));
    }

    #[test]
    fn native_openai_prefers_responses_without_changing_gateway_routing() {
        let mut provider = make_provider("openai");
        provider.native_openai = true;
        for model in [
            "gpt-4",
            "gpt-4o",
            "gpt-5-chat-latest",
            "gpt-6-astra",
            "future-model",
        ] {
            assert!(
                provider.should_use_responses_api_for_provider(model),
                "{model}"
            );
        }
        provider.base_path = "chat/completions".to_string();
        assert!(!provider.should_use_responses_api_for_provider("gpt-4o"));
        provider.base_path = "v1/chat/completions".to_string();
        assert!(provider.should_use_responses_api_for_provider("gpt-5.6-terra"));
        assert!(provider.should_use_responses_api_for_provider("gpt-4o"));
        provider.base_path = "v1/responses".to_string();
        assert!(provider.should_use_responses_api_for_provider("gpt-4o"));
        provider.base_path = "v1/chat/completions".to_string();
        provider.native_openai = false;
        assert!(!provider.should_use_responses_api_for_provider("gpt-4o"));
    }

    #[test]
    fn responses_api_routing_uses_model_family_unless_path_forces_chat() {
        for (model_name, base_path, expected) in [
            ("gpt-5.4", "v1/chat/completions", true),
            ("gpt-5.4-xhigh", "v1/chat/completions", true),
            ("gpt-5.6-sol", "v1/chat/completions", true),
            ("gpt-5.6-terra-xhigh", "v1/chat/completions", true),
            ("gpt-5.2-pro-2025-12-11", "v1/chat/completions", true),
            ("gpt-4o", "v1/chat/completions", false),
            ("gpt-5.2-codex", "openai/v1/chat/completions", false),
        ] {
            assert_eq!(
                OpenAiProvider::should_use_responses_api(model_name, base_path),
                expected,
                "unexpected routing for {model_name} via {base_path}"
            );
        }
    }

    #[test]
    fn custom_chat_path_maps_to_responses_path() {
        let responses_path = OpenAiProvider::map_base_path(
            "openai/v1/chat/completions",
            "responses",
            "v1/responses",
        );
        assert_eq!(responses_path, "openai/v1/responses");
    }

    #[test]
    fn responses_path_maps_to_models_path() {
        let models_path =
            OpenAiProvider::map_base_path("openai/v1/responses", "models", "v1/models");
        assert_eq!(models_path, "openai/v1/models");
    }

    #[test]
    fn parse_model_ids_accepts_openai_response() {
        let response = json!({"data": [{"id": "model-b"}, {"id": "model-a"}]});

        assert_eq!(parse_model_ids(&response).unwrap(), ["model-a", "model-b"]);
    }

    #[test]
    fn parse_model_ids_accepts_together_response() {
        let response = json!([
            {"id": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "type": "chat"},
            {"id": "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8", "type": "code"}
        ]);

        assert_eq!(
            parse_model_ids(&response).unwrap(),
            [
                "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
                "meta-llama/Llama-3.3-70B-Instruct-Turbo"
            ]
        );
    }

    #[test]
    fn parse_model_ids_rejects_unknown_response() {
        let response = json!({"models": []});

        assert!(parse_model_ids(&response).is_err());
    }

    #[test]
    fn unknown_path_falls_back_to_default_models_path() {
        let models_path = OpenAiProvider::map_base_path("custom/path", "models", "v1/models");
        assert_eq!(models_path, "v1/models");
    }

    #[test]
    fn absolute_chat_path_maps_to_absolute_responses_path() {
        let responses_path =
            OpenAiProvider::map_base_path("/v1/chat/completions", "responses", "v1/responses");
        assert_eq!(responses_path, "/v1/responses");
    }

    #[test]
    fn unknown_absolute_path_falls_back_to_absolute_models_path() {
        let models_path = OpenAiProvider::map_base_path("/custom/path", "models", "v1/models");
        assert_eq!(models_path, "/v1/models");
    }
    #[test]
    fn versionless_base_path_opts_out_of_responses_for_codex_models() {
        assert!(!OpenAiProvider::should_use_responses_api(
            "gpt-5-codex",
            "chat/completions"
        ));
    }

    #[test]
    fn custom_host_with_chat_completions_path_avoids_responses_routing() {
        // Custom hosts must use versionless "chat/completions" to keep should_use_responses_api
        // returning false — the path is detected as custom AND matches chat completions.
        assert!(!OpenAiProvider::should_use_responses_api(
            "o3",
            "chat/completions"
        ));
        assert!(!OpenAiProvider::should_use_responses_api(
            "gpt-5",
            "chat/completions"
        ));
    }

    #[test]
    fn ensure_url_scheme_adds_http_for_local_hosts() {
        assert_eq!(ensure_url_scheme("localhost:1234"), "http://localhost:1234");
        assert_eq!(
            ensure_url_scheme("127.0.0.1:8080/v1"),
            "http://127.0.0.1:8080/v1"
        );
        assert_eq!(ensure_url_scheme("0.0.0.0:3000"), "http://0.0.0.0:3000");
        assert_eq!(ensure_url_scheme("[::1]:1234"), "http://[::1]:1234");
    }

    #[test]
    fn ensure_url_scheme_adds_https_for_remote_hosts() {
        assert_eq!(
            ensure_url_scheme("api.example.com:8443/v1"),
            "https://api.example.com:8443/v1"
        );
        assert_eq!(ensure_url_scheme("example.com"), "https://example.com");
    }

    #[test]
    fn ensure_url_scheme_preserves_existing_scheme() {
        assert_eq!(
            ensure_url_scheme("http://localhost:1234"),
            "http://localhost:1234"
        );
        assert_eq!(
            ensure_url_scheme("https://api.openai.com/v1"),
            "https://api.openai.com/v1"
        );
    }

    fn custom_config(base_url: &str) -> DeclarativeProviderConfig {
        DeclarativeProviderConfig {
            name: "test-openai".to_string(),
            engine: crate::declarative::ProviderEngine::OpenAI,
            display_name: "Test OpenAI".to_string(),
            description: None,
            api_key_env: String::new(),
            base_url: base_url.to_string(),
            models: vec![crate::base::ModelInfo::new("test-model").with_context_limit(4096)],
            headers: None,
            session_id_header_override: None,
            timeout_seconds: None,
            supports_streaming: None,
            requires_auth: false,
            catalog_provider_id: None,
            base_path: None,
            env_vars: None,
            auth: None,
            dynamic_models: Some(false),
            skip_canonical_filtering: false,
            model_doc_link: None,
            setup_steps: vec![],
            toolshim: false,
            preserves_thinking: false,
            emit_clear_thinking: false,
            setup: None,
        }
    }

    #[tokio::test]
    async fn fetch_supported_model_info_preserves_configured_metadata() {
        let mut config = custom_config("http://localhost:1234");
        config.models = vec![crate::base::ModelInfo {
            reasoning: true,
            ..crate::base::ModelInfo::new("unrecognized-static-model").with_context_limit(4096)
        }];

        let provider = from_declarative_config(config, None, crate::declarative::EnvKeyResolver {})
            .unwrap()
            .build();

        let models = provider.fetch_supported_model_info().await.unwrap();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "unrecognized-static-model");
        assert_eq!(models[0].context_limit, Some(4096));
        assert!(models[0].reasoning);
    }

    // ------------------------------------------------------------------------
    // Capability wiring: what the endpoint declares, what it refuses, and how
    // each verdict is remembered.
    // ------------------------------------------------------------------------

    fn gateway_provider(
        server: &MockServer,
        name: &str,
        models: Vec<ModelInfo>,
        capability_cache: Option<Arc<ProbeCache>>,
    ) -> OpenAiProvider {
        let mut config = custom_config(&format!("{}/v1", server.uri()));
        config.name = name.to_string();
        config.dynamic_models = Some(false);
        config.models = models;
        from_declarative_config(config, None, crate::declarative::EnvKeyResolver {})
            .unwrap()
            .capability_cache(capability_cache)
            .build()
    }

    fn reasoning_config(model_name: &str) -> ModelConfig {
        let mut model_config = ModelConfig::new(model_name);
        model_config.reasoning = Some(true);
        model_config.with_thinking_effort(ThinkingEffort::High)
    }

    #[tokio::test]
    async fn endpoint_capabilities_are_read_from_models_and_published() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    { "id": "cn:hy4-preview", "supports_images": true,
                      "reasoning_supported_efforts": ["high"],
                      "reasoning_default_effort": "high" },
                    { "id": "oc-free", "object": "model", "owned_by": "free-lane" },
                ]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "choices": [{ "message": { "role": "assistant", "content": "ok" } }]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let provider = gateway_provider(
            &server,
            "custom_bing_publish",
            vec![ModelInfo::new("cn:hy4-preview"), ModelInfo::new("oc-free")],
            None,
        );
        let mut stream = provider
            .stream(&reasoning_config("cn:hy4-preview"), "system", &[], &[])
            .await
            .expect("stream");
        while stream.next().await.is_some() {}

        let hy4 = endpoint_capabilities::lookup("custom_bing_publish", "cn:hy4-preview")
            .endpoint
            .expect("the endpoint was asked and answered");
        assert_eq!(hy4.supports_vision, Some(true));
        assert_eq!(
            hy4.effort_levels(),
            vec![crate::thinking::ThinkingEffort::High]
        );
        // A listed-but-silent model still gets a record, so the menu can tell
        // "asked, nothing declared" apart from "never asked".
        assert!(
            endpoint_capabilities::lookup("custom_bing_publish", "oc-free")
                .endpoint
                .unwrap()
                .declares_nothing()
        );
    }

    #[tokio::test]
    async fn a_cold_start_model_takes_its_effort_from_the_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    { "id": "cn:cold-start",
                      "reasoning_supported_efforts": ["high"],
                      "reasoning_default_effort": "high" },
                ]
            })))
            .mount(&server)
            .await;
        let requests = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with({
                let requests = requests.clone();
                move |request: &wiremock::Request| {
                    let body: serde_json::Value =
                        serde_json::from_slice(&request.body).unwrap_or_default();
                    requests.lock().unwrap().push(body);
                    ResponseTemplate::new(200)
                        .set_body_json(json!({"choices": [{"message": {"content": "ok"}}]}))
                }
            })
            .expect(1)
            .mount(&server)
            .await;

        let provider = gateway_provider(
            &server,
            "custom_bing_cold_start",
            vec![ModelInfo::new("cn:cold-start")],
            None,
        );

        // Deliberately no `reasoning` preset: the endpoint is the only evidence.
        let mut stream = provider
            .stream(&ModelConfig::new("cn:cold-start"), "system", &[], &[])
            .await
            .expect("stream");
        while stream.next().await.is_some() {}

        let recorded = requests.lock().unwrap().clone();
        assert_eq!(recorded.len(), 1, "one request, no downgrade");
        assert_eq!(
            recorded[0]
                .get("reasoning_effort")
                .and_then(|value| value.as_str()),
            Some("high"),
            "the endpoint's vocabulary must reach the first request on a cold start"
        );
    }

    #[tokio::test]
    async fn a_refused_image_is_stripped_once_and_remembered() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let requests = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with({
                let requests = requests.clone();
                move |request: &wiremock::Request| {
                    let body: serde_json::Value =
                        serde_json::from_slice(&request.body).unwrap_or_default();
                    let carries_image = body.to_string().contains("image_url");
                    requests.lock().unwrap().push(body);
                    if carries_image {
                        ResponseTemplate::new(400).set_body_json(json!({
                            "error": { "message": "this model does not support image input" }
                        }))
                    } else {
                        ResponseTemplate::new(200)
                            .set_body_json(json!({"choices": [{"message": {"content": "ok"}}]}))
                    }
                }
            })
            .expect(2)
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let cache = Arc::new(ProbeCache::load(dir.path().join("model_capabilities.json")));
        let provider = gateway_provider(
            &server,
            "custom_bing_vision_probe",
            vec![ModelInfo::new("cn:vision-unknown")],
            Some(cache.clone()),
        );

        let messages = vec![Message::user().with_image("data:image/png;base64,aGk=", "image/png")];
        let mut stream = provider
            .stream(
                &ModelConfig::new("cn:vision-unknown"),
                "system",
                &messages,
                &[],
            )
            .await
            .expect("the second attempt, without images, must succeed");
        while stream.next().await.is_some() {}

        let recorded = requests.lock().unwrap().clone();
        assert_eq!(recorded.len(), 2, "one optimistic attempt, one downgraded");
        assert!(
            recorded[0].to_string().contains("image_url"),
            "the first attempt must actually send the image, or nothing was proven"
        );
        assert!(
            !recorded[1].to_string().contains("image_url"),
            "the retry must not carry the image again"
        );
        assert_eq!(
            cache.supports_vision(&provider.endpoint_identity(), "cn:vision-unknown"),
            Some(false),
            "the verdict must outlive the process that learned it"
        );
    }

    #[tokio::test]
    async fn a_refused_reasoning_effort_is_dropped_once_and_remembered() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let efforts = Arc::new(std::sync::Mutex::new(Vec::<Option<String>>::new()));
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with({
                let efforts = efforts.clone();
                move |request: &wiremock::Request| {
                    let body: serde_json::Value =
                        serde_json::from_slice(&request.body).unwrap_or_default();
                    let effort = body
                        .get("reasoning_effort")
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                    let refused = effort.is_some();
                    efforts.lock().unwrap().push(effort);
                    if refused {
                        ResponseTemplate::new(400).set_body_json(json!({
                            "error": { "message":
                                "unrecognized request argument supplied: reasoning_effort" }
                        }))
                    } else {
                        ResponseTemplate::new(200)
                            .set_body_json(json!({"choices": [{"message": {"content": "ok"}}]}))
                    }
                }
            })
            .expect(2)
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let cache = Arc::new(ProbeCache::load(dir.path().join("model_capabilities.json")));
        let provider = gateway_provider(
            &server,
            "custom_bing_effort_probe",
            vec![ModelInfo::new("cn:effort-unknown")],
            Some(cache.clone()),
        );

        let mut stream = provider
            .stream(&reasoning_config("cn:effort-unknown"), "system", &[], &[])
            .await
            .expect("the second attempt, without the effort, must succeed");
        while stream.next().await.is_some() {}

        assert_eq!(
            *efforts.lock().unwrap(),
            vec![Some("high".to_string()), None],
            "the level must be sent once, and dropped exactly once when refused"
        );
        assert_eq!(
            cache.supports_thinking_effort(&provider.endpoint_identity(), "cn:effort-unknown"),
            Some(false)
        );
    }

    #[tokio::test]
    async fn a_declared_capability_is_never_second_guessed_on_one_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({
                "error": { "message": "unrecognized request argument supplied: reasoning_effort" }
            })))
            .expect(1)
            .mount(&server)
            .await;

        let mut declared = ModelInfo::new("cn:declared-effort");
        declared.reasoning = true;
        let provider = gateway_provider(
            &server,
            "custom_bing_declared_effort",
            vec![declared],
            Some(Arc::new(ProbeCache::load(
                tempfile::tempdir()
                    .unwrap()
                    .path()
                    .join("model_capabilities.json"),
            ))),
        );

        let Err(error) = provider
            .stream(&reasoning_config("cn:declared-effort"), "system", &[], &[])
            .await
        else {
            panic!("a stated capability must have its refusal surfaced, not silently ignored");
        };
        assert!(
            error.to_string().contains("reasoning_effort"),
            "the error must reach the user so the declaration gets corrected: {error}"
        );
    }

    #[tokio::test]
    async fn a_missing_responses_api_falls_back_to_chat_and_is_remembered() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({
                "error": { "message": "unknown path /v1/responses" }
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "choices": [{ "message": { "role": "assistant", "content": "ok" } }]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let cache = Arc::new(ProbeCache::load(dir.path().join("model_capabilities.json")));
        let provider = gateway_provider(
            &server,
            "custom_bing_no_responses",
            vec![ModelInfo::new("global:gpt-6-luna")],
            Some(cache.clone()),
        );

        assert!(
            provider.should_use_responses_api_for_provider("global:gpt-6-luna"),
            "model-name routing still asks for /v1/responses first"
        );
        let mut stream = provider
            .stream(&reasoning_config("global:gpt-6-luna"), "system", &[], &[])
            .await
            .expect("the chat-completions retry must answer");
        while stream.next().await.is_some() {}

        assert_eq!(
            cache.supports_responses_api(&provider.endpoint_identity()),
            Some(false)
        );
        assert!(
            !provider.should_use_responses_api_for_provider("global:gpt-6-luna"),
            "and must not ask again on this base_url"
        );
    }

    #[test]
    fn a_cached_missing_responses_api_is_honoured_by_a_freshly_built_provider() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model_capabilities.json");
        ProbeCache::load(path.clone())
            .record_responses_api("http://free-lane.invalid/v1/chat/completions", false);

        let mut config = custom_config("http://free-lane.invalid/v1");
        config.name = "custom_bing_cached_no_responses".to_string();
        config.models = vec![ModelInfo::new("gpt-6-luna")];
        let provider = from_declarative_config(config, None, crate::declarative::EnvKeyResolver {})
            .unwrap()
            .capability_cache(Some(Arc::new(ProbeCache::load(path))))
            .build();

        assert!(
            !provider.should_use_responses_api_for_provider("gpt-6-luna"),
            "a gateway proven to lack the Responses API must not be asked again on \
             the next launch, however the model happens to be named"
        );
    }

    #[tokio::test]
    async fn a_provider_without_declared_models_never_calls_the_models_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": []})))
            .expect(0)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "choices": [{ "message": { "role": "assistant", "content": "ok" } }]
            })))
            .mount(&server)
            .await;

        let mut provider = OpenAiProvider::new(
            ApiClient::new_with_tls(server.uri(), AuthMethod::NoAuth, None).unwrap(),
        );
        provider.custom_models = None;

        let mut stream = provider
            .stream(&ModelConfig::new("gpt-4o"), "system", &[], &[])
            .await
            .expect("stream");
        while stream.next().await.is_some() {}
    }

    #[test]
    fn from_custom_config_preserves_ipv6_authority() {
        let provider = from_declarative_config(
            custom_config("http://[::1]:1234/v1"),
            None,
            crate::declarative::EnvKeyResolver,
        )
        .unwrap()
        .build();

        assert_eq!(provider.api_client.host(), "http://[::1]:1234");
    }

    #[test]
    fn from_custom_config_preserves_userinfo_authority() {
        let provider = from_declarative_config(
            custom_config("https://user:pass@gateway.example/v1"),
            None,
            crate::declarative::EnvKeyResolver,
        )
        .unwrap()
        .build();

        assert_eq!(
            provider.api_client.host(),
            "https://user:pass@gateway.example"
        );
    }

    #[test]
    fn parse_n_ctx_falls_back_to_sole_entry_when_id_differs() {
        let body = json!({
            "data": [
                { "id": "/models/qwen3.gguf", "meta": { "n_ctx": 32768 } }
            ]
        });
        assert_eq!(parse_n_ctx_from_models(&body, "qwen3"), Some(32768));
    }

    #[test]
    fn parse_n_ctx_no_fallback_with_multiple_unmatched_entries() {
        let body = json!({
            "data": [
                { "id": "model-a", "meta": { "n_ctx": 4096 } },
                { "id": "model-b", "meta": { "n_ctx": 8192 } }
            ]
        });
        assert_eq!(parse_n_ctx_from_models(&body, "model-c"), None);
    }

    #[test]
    fn parse_n_ctx_reads_relay_context_fields() {
        let workbuddy = json!({
            "data": [
                { "id": "global:gpt-6-luna", "context_length": 1000000 },
                { "id": "global:gpt-6.1-sol", "context_length": 1000000 }
            ]
        });
        assert_eq!(
            parse_n_ctx_from_models(&workbuddy, "global:gpt-6-luna"),
            Some(1_000_000)
        );

        let free_lane = json!({
            "data": [
                { "id": "oc-deepseek-v4.1-flash-free", "context_window": 262144 }
            ]
        });
        assert_eq!(
            parse_n_ctx_from_models(&free_lane, "oc-deepseek-v4.1-flash-free"),
            Some(262_144)
        );
    }

    #[test]
    fn parse_n_ctx_prefers_llama_cpp_meta_over_relay_fields() {
        let body = json!({
            "data": [
                { "id": "qwen3", "meta": { "n_ctx": 32768 }, "context_length": 999999 }
            ]
        });
        assert_eq!(parse_n_ctx_from_models(&body, "qwen3"), Some(32768));
    }

    #[test]
    fn derive_base_path_not_removing_api_path() {
        let r = derive_base_path("https://opencode.ai/zen/go");
        assert_eq!(r, "https://opencode.ai/zen/go/v1/chat/completions");
    }

    #[test]
    fn derive_base_path_should_support_v1() {
        let r = derive_base_path("https://opencode.ai/zen/go/v1");
        assert_eq!(r, "https://opencode.ai/zen/go/v1/chat/completions");
    }

    #[test]
    fn derive_base_path_should_support_no_base_path() {
        let r = derive_base_path("https://opencode.ai/");
        assert_eq!(r, "https://opencode.ai/v1/chat/completions");
    }

    #[test]
    fn derive_base_path_preserves_non_v1_version_prefix() {
        let r = derive_base_path("/api/paas/v4");
        assert_eq!(r, "api/paas/v4/chat/completions");
    }

    #[test]
    fn derive_base_path_does_not_treat_v_word_as_version() {
        let r = derive_base_path("/api/voice");
        assert_eq!(r, "api/voice/v1/chat/completions");
    }

    fn make_provider_with_custom_models(
        host: &str,
        base_path: &str,
        custom_models: Vec<String>,
    ) -> OpenAiProvider {
        OpenAiProvider {
            api_client: ApiClient::new_with_tls(host.to_string(), AuthMethod::NoAuth, None)
                .unwrap(),
            base_path: base_path.to_string(),
            organization: None,
            project: None,
            custom_headers: None,
            supports_streaming: true,
            name: "test-provider".to_string(),
            custom_models: Some(
                custom_models
                    .into_iter()
                    .map(|model| ModelInfo::new(model).with_context_limit(4096))
                    .collect(),
            ),
            dynamic_models: Some(true),
            skip_canonical_filtering: false,
            preserve_thinking_context: false,
            native_openai: false,
            n_ctx_cache: Arc::new(Mutex::new(HashMap::new())),
            capability_cache: None,
            responses_api_support: Arc::new(AtomicU8::new(RESPONSES_UNKNOWN)),
            endpoint_capabilities_loaded: Arc::new(OnceCell::new()),
            canonical_provider: None,
        }
    }

    #[tokio::test]
    async fn context_limit_caches_failed_models_probe() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(500))
            .expect(1)
            .mount(&server)
            .await;

        let mut provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["other-model".to_string()],
        );
        provider.custom_models = None;

        for _ in 0..2 {
            assert_eq!(
                provider.get_context_limit("unknown-model", None).await,
                crate::model::DEFAULT_CONTEXT_LIMIT
            );
        }
    }

    #[tokio::test]
    async fn context_limit_retries_expired_models_probe_failure() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(500))
            .expect(1)
            .mount(&server)
            .await;

        let mut provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["other-model".to_string()],
        );
        provider.custom_models = None;
        provider.n_ctx_cache.lock().unwrap().insert(
            "unknown-model".to_string(),
            CachedContextLimit::Failure(Instant::now() - N_CTX_FAILURE_TTL),
        );

        assert_eq!(
            provider.get_context_limit("unknown-model", None).await,
            crate::model::DEFAULT_CONTEXT_LIMIT
        );
    }

    #[tokio::test]
    async fn context_limit_caches_unsupported_models_endpoint() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
            .expect(1)
            .mount(&server)
            .await;

        let mut provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["other-model".to_string()],
        );
        provider.custom_models = None;

        assert_eq!(
            provider.get_context_limit("unknown-model", None).await,
            crate::model::DEFAULT_CONTEXT_LIMIT
        );
        assert_eq!(
            provider.get_context_limit("unknown-model", None).await,
            crate::model::DEFAULT_CONTEXT_LIMIT
        );
    }

    #[tokio::test]
    async fn fetch_models_treats_invalid_json_as_endpoint_not_found() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string("<html>not a models endpoint</html>"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["static-model".to_string()],
        );

        let err = provider.fetch_models_from_api().await.unwrap_err();
        assert!(err.is_endpoint_not_found(), "got: {:?}", err);
    }

    #[tokio::test]
    async fn fetch_models_returns_request_failed_for_missing_data_field() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status": "ok"})))
            .expect(1)
            .mount(&server)
            .await;

        let provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["static-model".to_string()],
        );

        let err = provider.fetch_models_from_api().await.unwrap_err();
        assert!(
            matches!(err, ProviderError::RequestFailed(_)),
            "expected RequestFailed, got: {:?}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_supported_models_falls_back_on_invalid_payload() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>error page</html>"))
            .mount(&server)
            .await;

        let predefined = vec!["glm-4.5".to_string(), "glm-5".to_string()];
        let provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            predefined.clone(),
        );

        let models = provider
            .fetch_supported_models()
            .await
            .expect("should fall back");
        assert_eq!(models, predefined);
    }

    #[tokio::test]
    async fn fetch_supported_models_propagates_auth_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "error": {"message": "invalid api key"}
            })))
            .mount(&server)
            .await;

        let provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["static-model".to_string()],
        );

        let err = provider.fetch_supported_models().await.unwrap_err();
        assert!(
            matches!(err, ProviderError::Authentication(_)),
            "got: {:?}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_supported_models_does_not_reclassify_400_as_endpoint_not_found() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({
                "error": {"message": "request is not valid JSON"}
            })))
            .mount(&server)
            .await;

        let provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["static-model".to_string()],
        );

        let err = provider.fetch_supported_models().await.unwrap_err();
        assert!(!err.is_endpoint_not_found(), "got: {:?}", err);
    }

    #[tokio::test]
    async fn nonstreaming_chat_accepts_legitimate_response() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "hello"},
                    "finish_reason": "stop"
                }],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
            })))
            .mount(&server)
            .await;

        let mut provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["test-model".to_string()],
        );
        provider.supports_streaming = false;

        let _stream = provider
            .stream(&ModelConfig::new("test-model"), "", &[], &[])
            .await
            .expect("legitimate non-streaming response should be accepted");
    }

    #[tokio::test]
    async fn nonstreaming_chat_rejects_oversized_response_body() {
        use crate::http_status::MAX_PROVIDER_JSON_RESPONSE_BYTES;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "a".repeat(MAX_PROVIDER_JSON_RESPONSE_BYTES + 1)
                    },
                    "finish_reason": "stop"
                }]
            })))
            .mount(&server)
            .await;

        let mut provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["test-model".to_string()],
        );
        provider.supports_streaming = false;

        let err = match provider
            .stream(&ModelConfig::new("test-model"), "", &[], &[])
            .await
        {
            Ok(_) => panic!("oversized response should be rejected"),
            Err(err) => err,
        };
        assert!(
            err.to_string().contains("response body exceeds"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn fetch_supported_models_accepts_payload_with_extra_fields() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [{"id": "model-a"}, {"id": "model-b"}],
                "message": "ok",
                "error": null
            })))
            .mount(&server)
            .await;

        let provider = make_provider_with_custom_models(
            &server.uri(),
            "v1/chat/completions",
            vec!["static-model".to_string()],
        );

        let models = provider.fetch_supported_models().await.unwrap();
        assert_eq!(models, vec!["model-a".to_string(), "model-b".to_string()]);
    }

    use crate::base::ThinkingPreservationFormat;

    fn cerebras_config() -> DeclarativeProviderConfig {
        crate::declarative::fixed_provider_configs()
            .expect("bundled providers should load")
            .into_iter()
            .find(|config| config.name == "cerebras")
            .expect("cerebras should be bundled")
    }

    fn cerebras_provider() -> OpenAiProvider {
        struct StaticKeyResolver;
        impl KeyResolver for StaticKeyResolver {
            type Error = std::convert::Infallible;

            fn resolve_key(&self, _key: &str) -> std::result::Result<String, Self::Error> {
                Ok("test-key".to_string())
            }
        }

        from_declarative_config(cerebras_config(), None, StaticKeyResolver)
            .expect("cerebras config should build a provider")
            .build()
    }

    #[test]
    fn cerebras_models_declare_thinking_preservation_and_reasoning_format() {
        let provider = cerebras_provider();

        for (model, expected_format) in [
            ("gpt-oss-120b", ThinkingPreservationFormat::ContentPrepend),
            ("zai-glm-4.7", ThinkingPreservationFormat::ContentXml),
            ("gemma-4-31b", ThinkingPreservationFormat::ContentPrepend),
        ] {
            let declared = provider
                .declared_model(model)
                .unwrap_or_else(|| panic!("{model} should be declared"));

            assert_eq!(declared.thinking_preservation_format, Some(expected_format));

            let reasoning_format = declared
                .request_params
                .as_ref()
                .and_then(|params| params.get("reasoning_format"));
            assert_eq!(
                reasoning_format,
                Some(&json!("parsed")),
                "{model} must request parsed reasoning"
            );
        }

        assert!(provider.declared_model("not-a-cerebras-model").is_none());
    }

    #[test]
    fn cerebras_preserves_thinking_by_default() {
        assert!(cerebras_config().preserves_thinking);
    }

    #[test]
    fn apply_declared_request_params_skips_reserved_keys() {
        let mut payload = json!({
            "model": "zai-glm-4.7",
            "stream": true,
            "stream_options": {"include_usage": true},
            "messages": [{"role": "user", "content": "hi"}]
        });

        let params = HashMap::from([
            ("reasoning_format".to_string(), json!("parsed")),
            ("model".to_string(), json!("hijacked")),
            ("stream".to_string(), json!(false)),
            ("stream_options".to_string(), json!(null)),
            ("messages".to_string(), json!([])),
        ]);

        apply_declared_request_params(&mut payload, &params);

        assert_eq!(payload["reasoning_format"], json!("parsed"));
        assert_eq!(payload["model"], json!("zai-glm-4.7"));
        assert_eq!(payload["stream"], json!(true));
        assert_eq!(payload["stream_options"], json!({"include_usage": true}));
        assert_eq!(payload["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn metadata_comes_from_the_registry() {
        let metadata = OpenAiProvider::metadata();
        let gpt_4o = metadata
            .known_models
            .iter()
            .find(|model| model.name == "gpt-4o")
            .expect("gpt-4o should come from the catalog");
        assert_eq!(gpt_4o.context_limit, Some(128_000));
        assert!(
            metadata
                .known_models
                .iter()
                .any(|model| model.name == "gpt-4"),
            "registry-only list should include models the old hardcoded list had drifted past"
        );
    }
}
