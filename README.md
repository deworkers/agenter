# Agenter

Локальный веб-чат с LLM: история диалогов, ручной и автоматический выбор модели, навыки (`SKILL.md`) и инструменты MCP. API работает на Node.js/Express/SQLite, интерфейс — на Vue 3/Vite.

## Быстрый запуск

Нужны Node.js 24+ и доступный OpenAI-совместимый endpoint модели. Чтобы подключённые MCP-серверы имели статус `ready`, запустите `mcp_proxy` на `127.0.0.1:8001` до старта API.

```powershell
npm install
Copy-Item .env.example .env
npm run dev:api
```

В другом терминале:

```powershell
npm run dev:web
```

Откройте адрес Vite (обычно `http://127.0.0.1:5173`). На macOS/Linux вместо `Copy-Item` используйте `cp .env.example .env`. Если нужен удалённый провайдер, укажите `OPENAI_API_KEY` в `.env` и перезапустите API. Для работы только с локальной моделью направьте все используемые маршруты Auto на `local`.

Подробная инструкция: [настройка провайдеров, маршрутизации, MCP и навыков](docs/configuration.ru.md).

## Проверка

```powershell
npm run typecheck
npm run lint
npm test
```

Состояние подключённых серверов и список обнаруженных инструментов доступны по `GET http://localhost:3000/api/mcp`. Недоступность отдельного MCP-сервера не останавливает API: он отображается со статусом `error`.
