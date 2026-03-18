process.env.LLM_USE_LOCAL_GPU = 'true';

if (!process.env.LLM_LOCAL_ENDPOINT) {
  process.env.LLM_LOCAL_ENDPOINT = 'http://127.0.0.1:11434';
}

process.env.CHATBOT_MODEL = 'HammerAI/llama-3-lexi-uncensored';

require('../src/index');