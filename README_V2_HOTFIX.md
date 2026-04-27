# MCP v2 hotfix для ElevenLabs

Что исправлено:

1. `leasing.get_subjects` больше не падает наружу при проблеме калькулятора/токена. Если API недоступен, tool возвращает fallback-категории для маршрутизации диалога и `calculator_available: false`.
2. Добавлен `leasing.check_subject_policy`: проверяет предмет лизинга сразу после ответа клиента и нормализует категорию. Пример: `грузовик` -> `Грузовой автомобиль`; для физлица вернет `ok: false`, а не даст агенту продолжить сбор года/стоимости.
3. `leasing.validate_cost`, `leasing.validate_advance_term`, `leasing.calculate_schedules` при ошибке внешнего калькулятора возвращают структурированный ответ, а не `Tool failed`. Это уменьшает риск ухода агента в странную ветку “оставьте номер”.
4. `/health` показывает, какие env-переменные реально заданы, без раскрытия значений.
5. Placeholder-значения вида `your_token_here` считаются незаданными.

Что обязательно проверить после деплоя:

- Открыть `https://<mcp-host>/health` и убедиться, что `env.ML_CALCULATOR_TOKEN: true`.
- В ElevenLabs нажать `Test Connection` у MCP.
- В списке tools должен появиться `leasing.check_subject_policy`.
- В prompt агента добавить патч из `prompts/elevenlabs_prompt_v2_hotfix_patch.md`.

Важно: если `ML_CALCULATOR_TOKEN` false, расчеты не будут нормально проходить. MCP будет вести себя мягче, но график без калькулятора не посчитает.
