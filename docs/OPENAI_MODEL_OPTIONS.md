# OpenAI model options

GPT-6 Luna (`gpt-6-luna`) is available anywhere the app offers registered OpenAI models.
Existing model selections and provider defaults are unchanged.

In chat, open **모델 옵션 → 사용 모델 요금 방식**. Standard/Flex preferences are saved per
provider and model in that chat, independently of the API key used. Only supported models offer
Flex. **기존 키 설정** uses the key's existing tier; choosing it again clears the model override.
Existing OpenAI key tiers, including legacy Priority/Batch values, are preserved. Newly registered
keys use Standard; the key registration form no longer selects a tier.

In **대시보드 설정 → 대필 모델**, a dedicated OpenAI model can have its own reasoning and
Standard/Flex preference. An existing dedicated configuration without a tier continues using its
key's tier. When the dedicated model is left at **답변 모델과 동일**, drafting follows the chat's
primary model, reasoning, and effective tier. Drafts still fill the composer without sending.

The chat API snapshots the effective tier into each queued job. Provider calls and cost calculation
use that snapshot even if the key changes while the job waits. Old jobs without a snapshot retain
their previous key fallback. Utility model flows keep their existing behavior.

Standard is sent as OpenAI's `service_tier: "default"`; Flex is sent as `"flex"`. The existing fetch
adapter preserves Flex for newer models unknown to the installed SDK. Requests never automatically
upgrade from Flex to Standard. Drafting retains its 50-second deadline, so slower Flex requests can
time out.

Luna uses the registered short/long-context and cache-write pricing. Flex halves those rates.
Its reasoning choices are none, low, medium, high, xhigh, and max, with medium as the model default.

Sources: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Flex processing](https://developers.openai.com/api/docs/guides/flex-processing).
