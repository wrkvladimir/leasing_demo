# Micro Leasing MCP optimized

Что изменено относительно исходного `mcp-chat-api-feat-migrate-jaicp-functions`:

1. Вместо длинных промптов-инструкций, которые возвращаются в контекст через `ForAgentCont.getPromtQuestionsStepsList`, добавлены короткие операционные MCP-инструменты:
   - `leasing.validate_cost`
   - `leasing.validate_advance_term`
   - `leasing.calculate_schedules`
   - `kb.search`
   - `currency.convert`
   - `phone.normalize_by`
   - `sms.send`
   - `amo.send_consultation`
2. Старые имена функций сохранены как compatibility aliases в обработчике вызовов, но не публикуются в `tools/list`, чтобы не раздувать контекст инструментария.
3. Добавлены HTTP keep-alive, таймауты, кеш курсов валют на 12 часов.
4. Расчет двух графиков выполняется параллельно через один tool call: `leasing.calculate_schedules` с `schedules: [0,1]`.
5. `.env` не включается в репозиторий; используйте `.env.example`.

## Запуск

```bash
cp .env.example .env
# заполнить токены
npm install
npm start
```

Health check:

```bash
curl http://localhost:3000/health
```

SSE endpoint для ElevenLabs/совместимого MCP клиента:

```text
http://<host>:3000/sse
```

## Рекомендация по ElevenLabs

В Agent Tools подключить только короткие инструменты из этого сервера. Текущий системный промпт заменить на `prompts/elevenlabs_system_prompt_optimized.md`. Не подключать одновременно старые `ForAgentCont.*` как видимые инструменты, иначе LLM снова будет тащить длинные инструкции в контекст.
