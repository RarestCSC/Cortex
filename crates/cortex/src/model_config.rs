use crate::config::{Config, ConfigError};
use crate::conversation::message::Message;
use crate::providers::base::Provider;
use anyhow::{anyhow, Result};
use cortex_providers::conversation::token_usage::ProviderUsage;
use cortex_providers::endpoint_capabilities;
use cortex_providers::errors::ProviderError;
use cortex_providers::model::ModelConfig;
use cortex_providers::thinking::ThinkingEffort;
use rmcp::model::Tool;
use serde_json::Value;
use std::collections::HashMap;

pub fn model_config_from_user_config(
    provider_name: &str,
    model_name: impl AsRef<str>,
) -> Result<ModelConfig> {
    let model = base_model_config_from_user_config(provider_name, model_name.as_ref())?;
    materialize_model_config(provider_name, model)
}

pub fn model_config_from_user_config_with_session_settings(
    provider_name: &str,
    model_name: impl AsRef<str>,
    previous: Option<&ModelConfig>,
    request_params: Option<HashMap<String, Value>>,
    _context_limit: Option<usize>,
) -> Result<ModelConfig> {
    let config = Config::global();
    let model = base_model_config_from_user_config(provider_name, model_name.as_ref())?;
    // Precedence for the effort level: the level already picked in this
    // session, then the user's global setting, then whatever the endpoint
    // said it defaults to. Resolved here rather than at injection time so the
    // inherited pick above still wins.
    let default_effort = config
        .get_goose_thinking_effort()
        .or_else(|| model.endpoint_default_effort());
    let model = materialize_model_config_inner(model, provider_name, false)?
        .with_inherited_session_settings_from(previous, request_params)
        .with_default_thinking_effort(default_effort);

    Ok(apply_canonical_limits(provider_name, model))
}

pub fn materialize_model_config(provider_name: &str, model: ModelConfig) -> Result<ModelConfig> {
    let model = materialize_model_config_inner(model, provider_name, true)?;
    Ok(apply_canonical_limits(provider_name, model))
}

fn apply_canonical_limits(provider_name: &str, model: ModelConfig) -> ModelConfig {
    if provider_name == cortex_providers::azure_foundry::AZURE_FOUNDRY_PROVIDER_NAME {
        model
    } else {
        model
            .with_canonical_limits(provider_name)
            .with_canonical_vision_support(provider_name)
    }
}

fn materialize_model_config_inner(
    mut model: ModelConfig,
    provider_name: &str,
    include_default_thinking_effort: bool,
) -> Result<ModelConfig> {
    let config = Config::global();

    if model.temperature.is_none() {
        model = model.with_temperature(get_goose_temperature(config)?);
    }

    if model.toolshim && model.toolshim_model.is_none() {
        model = model.with_toolshim_model(get_goose_toolshim_model(config)?);
    }

    model = model.with_default_max_tokens(config.get_goose_max_tokens()?);

    if include_default_thinking_effort {
        let default_effort = config
            .get_goose_thinking_effort()
            .or_else(|| model.endpoint_default_effort());
        model = model.with_default_thinking_effort(default_effort);
    }

    if model.cache_ttl().is_none() {
        if let Some(ttl) = get_goose_cache_ttl(config)? {
            model = model.with_cache_ttl(&ttl);
        }
    }

    if provider_name == cortex_providers::openai::OPEN_AI_PROVIDER_NAME {
        model = apply_openai_request_params(model);
    }

    Ok(model)
}

fn one_shot_model_config(model_config: ModelConfig) -> ModelConfig {
    model_config
        .with_thinking_effort(ThinkingEffort::Off)
        .with_prompt_cache_disabled()
}

/// Run a completion for a one-shot auxiliary task on the main session model.
/// Thinking is disabled and prompt-cache writes are skipped because this prompt
/// will not recur.
pub async fn complete_one_shot(
    provider: &dyn Provider,
    model_config: &ModelConfig,
    session_id: &str,
    system: &str,
    messages: &[Message],
    tools: &[Tool],
) -> Result<(Message, ProviderUsage), ProviderError> {
    let one_shot_model_config = one_shot_model_config(model_config.clone());

    crate::session_context::with_session_id(
        Some(session_id.to_string()),
        provider.complete(&one_shot_model_config, system, messages, tools),
    )
    .await
}

fn apply_openai_request_params(mut model: ModelConfig) -> ModelConfig {
    let config = Config::global();
    if let Some(store) = config.get_openai_store() {
        model = model.with_merged_request_params(HashMap::from([(
            "store".to_string(),
            serde_json::json!(store),
        )]));
    }
    model
}

fn base_model_config_from_user_config(
    provider_name: &str,
    model_name: &str,
) -> Result<ModelConfig> {
    let config = Config::global();
    let mut model = ModelConfig {
        model_name: model_name.to_string(),
        context_limit: None,
        temperature: get_goose_temperature(config)?,
        max_tokens: None,
        toolshim: get_goose_toolshim(config)?.unwrap_or(false),
        toolshim_model: get_goose_toolshim_model(config)?,
        request_params: None,
        reasoning: None,
        supports_vision: None,
        endpoint_capabilities: None,
        request_headers: None,
    };
    if provider_name != cortex_providers::azure_foundry::AZURE_FOUNDRY_PROVIDER_NAME {
        model.normalize_effort_suffix();
    }
    Ok(apply_declared_capabilities(provider_name, model))
}

/// Attach what the provider configuration and the endpoint said about this model.
///
/// Runs before `apply_canonical_limits` on purpose. That function fills
/// `reasoning` from the catalog only while the field is still `None`, so
/// injecting afterwards would let the catalog overwrite the declaration — and
/// the catalog never carries a gateway's own model names to begin with, which
/// is why the declaration has to land first.
///
/// Every write is `is_none`-guarded: the incoming value is authoritative
/// (same contract as `supports_vision`), so a caller that already knows the
/// answer keeps it.
fn apply_declared_capabilities(provider_name: &str, mut model: ModelConfig) -> ModelConfig {
    let declared = crate::config::declarative_providers::declared_capabilities(
        provider_name,
        &model.model_name,
    );
    let endpoint = endpoint_capabilities::lookup(provider_name, &model.model_name).endpoint;

    if model.reasoning.is_none() {
        model.reasoning = declared
            .and_then(|declared| declared.reasoning)
            .or_else(|| {
                endpoint
                    .as_ref()
                    .and_then(|endpoint| endpoint.supports_reasoning)
            })
            // An endpoint that listed the model with a vocabulary but no
            // `supports_reasoning` flag still reasoned: it just did not say so
            // in that field.
            .or_else(|| {
                endpoint
                    .as_ref()
                    .filter(|endpoint| !endpoint.declares_nothing())
                    .filter(|endpoint| !endpoint.effort_levels().is_empty())
                    .map(|_| true)
            });
    }
    if model.supports_vision.is_none() {
        model.supports_vision = declared
            .and_then(|declared| declared.supports_vision)
            .or_else(|| {
                endpoint
                    .as_ref()
                    .and_then(|endpoint| endpoint.supports_vision)
            });
    }
    if let Some(endpoint) = endpoint {
        model.endpoint_capabilities = Some(endpoint);
    }
    model
}

/// Re-derive the prompt-cache TTL from the current configuration, discarding
/// any value stored on the model config. The TTL is configuration state, not
/// session state: a resumed session must reflect the user's current opt-in,
/// not a value persisted by an earlier (possibly clamped) run.
pub fn with_rederived_cache_ttl(model: ModelConfig) -> Result<ModelConfig> {
    let mut model = model.without_cache_ttl();
    if let Some(ttl) = get_goose_cache_ttl(Config::global())? {
        model = model.with_cache_ttl(&ttl);
    }
    Ok(model)
}

fn get_goose_cache_ttl(config: &Config) -> Result<Option<String>> {
    match config.get_param::<String>("GOOSE_CACHE_TTL") {
        Ok(ttl) => {
            let ttl = ttl.trim().to_lowercase();
            match ttl.as_str() {
                "5m" | "1h" => Ok(Some(ttl)),
                other => Err(anyhow!(
                    "GOOSE_CACHE_TTL must be '5m' or '1h', got '{other}'"
                )),
            }
        }
        Err(ConfigError::NotFound(_)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn get_goose_temperature(config: &Config) -> Result<Option<f32>> {
    match config.get_param::<f32>("GOOSE_TEMPERATURE") {
        Ok(temp) if temp < 0.0 => Err(anyhow!(
            "Value for 'GOOSE_TEMPERATURE' is out of valid range: {temp}"
        )),
        Ok(temp) => Ok(Some(temp)),
        Err(ConfigError::NotFound(_)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn get_goose_toolshim(config: &Config) -> Result<Option<bool>> {
    match config.get_param::<serde_yaml::Value>("GOOSE_TOOLSHIM") {
        Ok(value) => parse_yaml_bool_config("GOOSE_TOOLSHIM", value).map(Some),
        Err(ConfigError::NotFound(_)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Resolve the global toolshim setting, defaulting to false when unset.
pub fn global_toolshim() -> bool {
    get_goose_toolshim(Config::global())
        .ok()
        .flatten()
        .unwrap_or(false)
}

fn get_goose_toolshim_model(config: &Config) -> Result<Option<String>> {
    match config.get_param::<String>("GOOSE_TOOLSHIM_OLLAMA_MODEL") {
        Ok(value) if value.trim().is_empty() => Err(anyhow!(
            "Invalid value for 'GOOSE_TOOLSHIM_OLLAMA_MODEL': '{value}' - cannot be empty if set"
        )),
        Ok(value) => Ok(Some(value)),
        Err(ConfigError::NotFound(_)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn parse_bool_config(key: &str, value: &str) -> Result<bool> {
    match value.to_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(anyhow!(
            "Invalid value for '{key}': '{value}' - must be one of: 1, true, yes, on, 0, false, no, off"
        )),
    }
}

fn parse_yaml_bool_config(key: &str, value: serde_yaml::Value) -> Result<bool> {
    match value {
        serde_yaml::Value::Bool(value) => Ok(value),
        serde_yaml::Value::Number(value) => parse_bool_config(key, &value.to_string()),
        serde_yaml::Value::String(value) => parse_bool_config(key, &value),
        other => {
            Err(anyhow!(
            "Invalid value for '{key}': '{}' - must be one of: 1, true, yes, on, 0, false, no, off",
            serde_yaml::to_string(&other).unwrap_or_else(|_| "<unprintable>".to_string()).trim()
        ))
        }
    }
}

#[cfg(test)]
mod one_shot_tests {
    use super::*;

    #[test]
    fn thinking_and_prompt_cache_are_disabled() {
        let config = one_shot_model_config(
            ModelConfig::new("claude-haiku-4-5").with_thinking_effort(ThinkingEffort::High),
        );

        assert_eq!(config.thinking_effort(), Some(ThinkingEffort::Off));
        assert!(config.prompt_cache_disabled());
    }
}

#[cfg(test)]
mod cache_ttl_tests {
    use super::*;

    #[test]
    fn env_var_populates_cache_ttl() {
        let _guard = env_lock::lock_env([("GOOSE_CACHE_TTL", Some("1h"))]);
        let model = materialize_model_config_inner(
            ModelConfig::new("claude-sonnet-4-5"),
            "anthropic",
            false,
        )
        .unwrap();
        assert_eq!(model.cache_ttl().as_deref(), Some("1h"));
    }

    #[test]
    fn absent_env_var_leaves_cache_ttl_unset() {
        let _guard = env_lock::lock_env([("GOOSE_CACHE_TTL", None::<&str>)]);
        let model = materialize_model_config_inner(
            ModelConfig::new("claude-sonnet-4-5"),
            "anthropic",
            false,
        )
        .unwrap();
        assert!(model.cache_ttl().is_none());
    }

    #[test]
    fn invalid_env_var_is_rejected() {
        let _guard = env_lock::lock_env([("GOOSE_CACHE_TTL", Some("2h"))]);
        let result = materialize_model_config_inner(
            ModelConfig::new("claude-sonnet-4-5"),
            "anthropic",
            false,
        );
        assert!(result.is_err());
    }

    #[test]
    fn rederive_replaces_stored_ttl_with_configured_value() {
        let _guard = env_lock::lock_env([("GOOSE_CACHE_TTL", Some("1h"))]);
        let model =
            with_rederived_cache_ttl(ModelConfig::new("claude-sonnet-4-5").with_cache_ttl("5m"))
                .unwrap();
        assert_eq!(model.cache_ttl().as_deref(), Some("1h"));
    }

    #[test]
    fn rederive_drops_stored_ttl_when_config_absent() {
        let _guard = env_lock::lock_env([("GOOSE_CACHE_TTL", None::<&str>)]);
        let model =
            with_rederived_cache_ttl(ModelConfig::new("claude-sonnet-4-5").with_cache_ttl("1h"))
                .unwrap();
        assert!(model.cache_ttl().is_none());
    }

    #[test]
    fn explicit_model_ttl_wins_over_env_var() {
        let _guard = env_lock::lock_env([("GOOSE_CACHE_TTL", Some("1h"))]);
        let model = materialize_model_config_inner(
            ModelConfig::new("claude-sonnet-4-5").with_cache_ttl("5m"),
            "anthropic",
            false,
        )
        .unwrap();
        assert_eq!(model.cache_ttl().as_deref(), Some("5m"));
    }
}

#[cfg(test)]
mod azure_foundry_tests {
    use super::*;

    #[test]
    fn deployment_name_survives_thinking_effort_changes() {
        let config = base_model_config_from_user_config("azure_foundry", "gpt-5-high")
            .unwrap()
            .with_thinking_effort(ThinkingEffort::Off);

        assert_eq!(config.model_name, "gpt-5-high");
        assert_eq!(config.context_limit, None);
        assert_eq!(config.thinking_effort(), Some(ThinkingEffort::Off));
    }

    #[test]
    fn none_suffixed_deployment_name_is_preserved() {
        let config = base_model_config_from_user_config("azure_foundry", "gpt-5-none").unwrap();

        assert_eq!(config.model_name, "gpt-5-none");
        assert_eq!(config.thinking_effort(), None);
    }
}

#[cfg(test)]
mod declared_capability_tests {
    use super::*;
    use cortex_providers::endpoint_capabilities::{
        publish_declared, publish_endpoint, DeclaredCapabilities, EndpointModelCapabilities,
    };
    use serde_json::json;

    /// Isolated config root, so a `GOOSE_THINKING_EFFORT` in the developer's own
    /// config cannot decide what these tests assert. Both variables go into one
    /// lock: `env_lock` serialises globally, so two guards in one test deadlock.
    fn isolated_config(thinking_effort: Option<&str>) -> (tempfile::TempDir, impl Sized) {
        let dir = tempfile::tempdir().unwrap();
        let guard = env_lock::lock_env([
            ("GOOSE_PATH_ROOT", Some(dir.path().to_str().unwrap())),
            ("GOOSE_THINKING_EFFORT", thinking_effort),
        ]);
        (dir, guard)
    }

    fn gateway(entry: serde_json::Value) -> EndpointModelCapabilities {
        EndpointModelCapabilities::from_models_entry(&entry)
    }

    #[test]
    fn a_custom_providers_reasoning_true_reaches_the_model_config() {
        // B1's acceptance criterion: the declaration used to stop at
        // `ModelInfo` because `model_config.rs` hardcoded `reasoning: None`.
        publish_declared(
            "custom_bing_b1_true",
            "cn:space-bunny-b1",
            DeclaredCapabilities {
                reasoning: Some(true),
                supports_vision: None,
            },
        );

        let model = model_config_from_user_config("custom_bing_b1_true", "cn:space-bunny-b1")
            .expect("model config");

        assert_eq!(model.reasoning, Some(true));
        assert!(
            model.sends_thinking_effort(),
            "a declared reasoning model must be adjustable"
        );
    }

    #[test]
    fn a_custom_providers_reasoning_false_overrides_a_name_heuristic() {
        // `cn:glm-5.3-flash` is recognised by name as reasoning. Declaring it
        // otherwise must be honoured, or the menu promises what the declaration
        // denies.
        publish_declared(
            "custom_bing_b1_false",
            "cn:glm-5.3-flash",
            DeclaredCapabilities {
                reasoning: Some(false),
                supports_vision: None,
            },
        );

        let model = model_config_from_user_config("custom_bing_b1_false", "cn:glm-5.3-flash")
            .expect("model config");

        assert_eq!(model.reasoning, Some(false));
        assert!(!model.sends_thinking_effort());
    }

    #[test]
    fn the_declaration_is_injected_before_the_catalog_can_answer() {
        // D4: `with_canonical_limits` fills `reasoning` only while it is `None`,
        // so injection has to happen first or the catalog silently wins.
        publish_declared(
            "custom_bing_order",
            "gpt-4o-mini",
            DeclaredCapabilities {
                reasoning: Some(true),
                supports_vision: None,
            },
        );

        let model = model_config_from_user_config("custom_bing_order", "gpt-4o-mini")
            .expect("model config");

        assert_eq!(
            model.reasoning,
            Some(true),
            "the user's declaration must not be overwritten by the catalog"
        );
        assert_eq!(
            apply_canonical_limits("custom_bing_order", ModelConfig::new("gpt-4o-mini")).reasoning,
            Some(false),
            "without a declaration the catalog keeps answering"
        );
    }

    #[test]
    fn endpoint_metadata_feeds_reasoning_vision_and_the_effort_vocabulary() {
        let _isolated = isolated_config(None);
        publish_endpoint(
            "custom_bing_b2",
            "cn:hy4-preview",
            gateway(json!({
                "id": "cn:hy4-preview",
                "supports_images": true,
                "reasoning_supported_efforts": ["high"],
                "reasoning_default_effort": "high",
            })),
        );

        let model = model_config_from_user_config("custom_bing_b2", "cn:hy4-preview")
            .expect("model config");

        assert_eq!(model.supports_vision, Some(true));
        assert_eq!(
            model.reasoning,
            Some(true),
            "a published vocabulary is a reason to adjust"
        );
        assert_eq!(model.endpoint_effort_levels(), [ThinkingEffort::High]);
        assert_eq!(
            model.endpoint_default_effort(),
            Some(ThinkingEffort::High),
            "`reasoning_default_effort` becomes the fallback level"
        );
    }

    #[test]
    fn a_silent_endpoint_does_not_invent_a_reasoning_flag_or_a_default() {
        let _isolated = isolated_config(None);
        publish_endpoint(
            "custom_bing_b2_silent",
            "oc-space-bunny-free",
            gateway(
                json!({"id": "oc-space-bunny-free", "object": "model", "owned_by": "free-lane"}),
            ),
        );

        let model = model_config_from_user_config("custom_bing_b2_silent", "oc-space-bunny-free")
            .expect("model config");

        assert_eq!(model.reasoning, None);
        assert_eq!(model.endpoint_default_effort(), None);
        assert!(
            model.endpoint_declares_nothing(),
            "the endpoint was asked and answered with nothing — which the menu turns \
             into a settings hint rather than a silent single stop"
        );
    }

    #[test]
    fn the_endpoint_default_only_fills_a_gap() {
        // `Config::global()` is a process-wide singleton, so the precedence this
        // actually has to guarantee is asserted on the mechanism rather than on
        // whatever this machine's config happens to say.
        let fallback = ThinkingEffort::High;

        let untouched = ModelConfig::new("cn:space-bunny-defaults");
        assert_eq!(
            untouched
                .with_default_thinking_effort(Some(fallback))
                .thinking_effort(),
            Some(fallback)
        );

        let already_chosen =
            ModelConfig::new("cn:space-bunny-defaults").with_thinking_effort(ThinkingEffort::Low);
        assert_eq!(
            already_chosen
                .with_default_thinking_effort(Some(fallback))
                .thinking_effort(),
            Some(ThinkingEffort::Low),
            "a level already picked — by the session or by GOOSE_THINKING_EFFORT — stands"
        );
    }

    #[test]
    fn the_users_thinking_effort_setting_outranks_the_endpoints_default() {
        let _isolated = isolated_config(Some("low"));
        publish_endpoint(
            "custom_bing_default",
            "cn:space-bunny-default",
            gateway(json!({
                "id": "cn:space-bunny-default",
                "reasoning_supported_efforts": ["low", "high", "xhigh"],
                "reasoning_default_effort": "high",
            })),
        );

        let model = model_config_from_user_config("custom_bing_default", "cn:space-bunny-default")
            .expect("model config");

        assert_eq!(model.thinking_effort(), Some(ThinkingEffort::Low));
    }

    #[test]
    fn a_session_pick_outranks_the_endpoints_default() {
        let _isolated = isolated_config(None);
        publish_endpoint(
            "custom_bing_session",
            "cn:space-bunny-session",
            gateway(json!({
                "id": "cn:space-bunny-session",
                "reasoning_supported_efforts": ["low", "high"],
                "reasoning_default_effort": "high",
            })),
        );
        let previous =
            ModelConfig::new("cn:space-bunny-session").with_thinking_effort(ThinkingEffort::Low);

        let model = model_config_from_user_config_with_session_settings(
            "custom_bing_session",
            "cn:space-bunny-session",
            Some(&previous),
            None,
            None,
        )
        .expect("model config");

        assert_eq!(model.thinking_effort(), Some(ThinkingEffort::Low));
    }

    #[test]
    fn a_custom_providers_vision_declaration_reaches_the_model_config() {
        publish_declared(
            "custom_bing_vision",
            "zai-org/GLM-5.3-Flash",
            DeclaredCapabilities {
                reasoning: None,
                supports_vision: Some(true),
            },
        );

        let model = model_config_from_user_config("custom_bing_vision", "zai-org/GLM-5.3-Flash")
            .expect("model config");

        assert_eq!(model.supports_vision, Some(true));
    }
}

#[cfg(test)]
mod canonical_vision_tests {
    use super::*;

    #[test]
    fn apply_canonical_limits_resolves_vision_support() {
        let model = apply_canonical_limits("alibaba-token-plan", ModelConfig::new("qwen3.8-flash"));

        assert_eq!(model.supports_vision, Some(true));
    }

    #[test]
    fn apply_canonical_limits_leaves_unknown_providers_untouched() {
        let model = apply_canonical_limits("my-custom-provider", ModelConfig::new("some-model"));

        assert_eq!(model.supports_vision, None);
    }
}
