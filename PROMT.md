# Задача: реализовать простой расширяемый LLM Agent

Необходимо разработать небольшое web-приложение — LLM-агент с текстовым чатом, историей диалогов, поддержкой Skills, MCP и возможностью автоматически выбирать LLM-провайдера/модель в зависимости от задачи.

Главная цель проекта — получить простой и понятный agent harness без использования тяжелых agent-frameworks вроде LangChain/LangGraph.

Архитектура должна позволять постепенно расширять приложение, не переписывая основной Agent Runtime.

## 1. Технологический стек

Использовать:

### Backend

- Node.js
- TypeScript
- Express
- SQLite
- SSE для streaming ответа
- официальный MCP SDK
- OpenAI-compatible API
- Anthropic API

### Frontend

- Vue 3
- TypeScript
- Composition API
- `<script setup>`
- Vite
- простой CSS/LESS

Не использовать React.

Не использовать LangChain/LangGraph без реальной необходимости.

## 2. Основной функционал

Приложение должно предоставлять обычный интерфейс LLM-чата.

Пользователь должен иметь возможность:

- создать новый чат;
- увидеть список предыдущих чатов;
- открыть существующий чат;
- продолжить существующий диалог;
- удалить чат;
- отправить сообщение;
- получать streaming-ответ модели;
- видеть используемую модель;
- видеть выполненные tool calls;
- выбирать модель вручную;
- использовать автоматический выбор модели;
- подключать Skills;
- подключать MCP servers.

История чатов должна сохраняться между перезапусками приложения.

## 3. Архитектура

Основные backend-компоненты:

```text
ChatService
AgentRuntime
ContextBuilder
ProviderRouter
ProviderRegistry
SkillRegistry
ToolRegistry
McpManager
Storage
```

Зависимости должны быть направлены через интерфейсы.

AgentRuntime не должен зависеть напрямую от OpenAI, Anthropic, LM Studio или другого конкретного API.

Пример общего потока:

```text
User Message
     ↓
ChatService
     ↓
load history
     ↓
ContextBuilder
     ↓
SkillRegistry
     ↓
ToolRegistry / MCP
     ↓
ProviderRouter
     ↓
LLM Provider
     ↓
tool call?
  ┌── YES ───────────┐
  ↓                  │
execute tool         │
  ↓                  │
append result ───────┘
     ↓
assistant response
     ↓
save history
     ↓
SSE → frontend
```

## 4. Provider abstraction

Создать общий интерфейс LLM provider.

Пример:

```ts
interface LlmProvider {
    id: string;

    chat(request: LlmRequest): AsyncIterable<LlmEvent>;

    supportsTools(): boolean;

    supportsVision(): boolean;

    getContextWindow(): number;
}
```

Конкретные реализации не должны проникать в AgentRuntime.

На первом этапе реализовать:

```text
OpenAICompatibleProvider
AnthropicProvider
```

OpenAICompatibleProvider должен поддерживать произвольный:

```text
baseUrl
apiKey
model
```

Это позволит использовать:

- OpenAI;
- LM Studio;
- llama.cpp;
- Ollama с OpenAI-compatible endpoint;
- vLLM;
- другие совместимые серверы.

## 5. Provider Registry

Создать:

```text
ProviderRegistry
```

Он отвечает за регистрацию и получение доступных моделей.

Конфигурация должна быть вынесена из исходного кода.

Например:

```yaml
providers:

  local-fast:
    type: openai-compatible
    baseUrl: http://localhost:1234/v1
    apiKey: local
    model: qwen3.5-9b

  local-code:
    type: openai-compatible
    baseUrl: http://localhost:1234/v1
    apiKey: local
    model: qwen3-coder-30b-a3b

  claude:
    type: anthropic
    apiKey: ${ANTHROPIC_API_KEY}
    model: <configured-model>
```

Не хранить реальные API keys в git.

Поддержать environment variables.

## 6. Provider Router

Создать отдельный:

```text
ProviderRouter
```

Он выбирает модель для конкретного запроса.

Поддержать два режима:

```text
manual
auto
```

### Manual

Пользователь выбирает модель самостоятельно.

### Auto

ProviderRouter определяет подходящую модель.

Типы задач:

```ts
type TaskType =
    | "simple"
    | "coding"
    | "reasoning"
    | "research"
    | "vision";
```

Первая реализация должна быть простой и rule-based.

Например:

```text
image attached
    → vision

coding skill active
    → coding

MCP/tools required
    → reasoning

simple conversation
    → simple
```

Конфигурация routing также должна находиться вне исходного кода.

Например:

```yaml
routes:

  simple:
    provider: local-fast

  coding:
    provider: local-code

  reasoning:
    provider: claude

  research:
    provider: claude
```

Архитектура должна позволять позже заменить rule-based router на LLM classifier.

## 7. Skills

Реализовать простой Skill Registry.

Skills должны находиться в файловой системе:

```text
skills/
    code-review/
        SKILL.md

    research/
        SKILL.md

    debugging/
        SKILL.md
```

Формат:

```markdown
---
name: code-review
description: Review source code for bugs and maintainability
---

# Code Review

When reviewing code:

1. Inspect correctness.
2. Look for security problems.
3. Look for unnecessary complexity.
4. Suggest concrete fixes.
```

SkillRegistry должен:

1. сканировать директорию `skills`;
2. читать metadata;
3. регистрировать доступные skills;
4. предоставлять список skills AgentRuntime;
5. загружать полное содержимое skill только когда оно необходимо.

Не добавлять содержимое всех SKILL.md в каждый prompt.

Metadata skills можно использовать для определения подходящего skill.

На первом этапе допустим ручной выбор skill пользователем.

Архитектура должна позволять позже добавить автоматический выбор skills.

## 8. MCP

Добавить поддержку Model Context Protocol.

Создать:

```text
McpManager
```

McpManager должен:

- читать конфигурацию MCP servers;
- запускать/подключать MCP servers;
- получать список tools;
- преобразовывать MCP tools во внутренний формат ToolRegistry;
- выполнять tool calls;
- возвращать результат AgentRuntime.

Начальная версия должна поддерживать MCP через:

```text
stdio
```

Конфигурация:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "./workspace"
      ]
    }
  }
}
```

AgentRuntime не должен различать MCP tool и обычный локальный tool.

## 9. Tool Registry

Создать единый:

```text
ToolRegistry
```

Внутренний интерфейс:

```ts
interface Tool {
    name: string;
    description: string;
    inputSchema: object;

    execute(args: unknown): Promise<unknown>;
}
```

Источниками tools могут быть:

```text
ToolRegistry
   │
   ├── LocalTool
   │
   └── McpTool
```

Это позволит позже добавлять собственные инструменты без MCP.

## 10. Agent Runtime

AgentRuntime является главным orchestration layer.

Он должен:

1. получить сообщение;
2. получить историю;
3. определить активные skills;
4. получить доступные tools;
5. построить context;
6. выбрать provider;
7. отправить запрос модели;
8. обработать streaming;
9. определить tool calls;
10. выполнить tools;
11. добавить tool results;
12. повторно вызвать LLM;
13. получить финальный ответ;
14. сохранить run;
15. сохранить сообщения.

Предусмотреть ограничение количества tool-loop итераций.

Например:

```text
MAX_TOOL_ITERATIONS = 10
```

AgentRuntime не должен содержать provider-specific код.

## 11. Context Builder

Создать:

```text
ContextBuilder
```

Он формирует context модели из:

```text
base system prompt

+

active skills

+

tool descriptions

+

chat history

+

current message
```

Не смешивать формирование context с Provider или ChatService.

В будущем сюда можно будет добавить:

- context compression;
- summarization;
- RAG;
- memory;
- token budgeting.

## 12. Хранение данных

Для MVP использовать SQLite.

Минимальная схема:

```text
chats
-----
id
title
created_at
updated_at
```

```text
messages
--------
id
chat_id
role
content
provider
model
created_at
```

```text
runs
----
id
chat_id
message_id
provider
model
status
tokens_in
tokens_out
duration_ms
created_at
```

```text
tool_calls
----------
id
run_id
tool_name
arguments
result
status
created_at
```

Сделать repository/storage abstraction, чтобы SQLite не использовался напрямую из AgentRuntime.

## 13. API

Минимальные endpoints:

```text
GET    /api/chats
POST   /api/chats

GET    /api/chats/:id
DELETE /api/chats/:id

GET    /api/providers
GET    /api/skills
GET    /api/mcp

POST   /api/chats/:id/messages
```

Последний endpoint должен поддерживать streaming.

Предпочтительно SSE.

## 14. Frontend

Сделать простой UI в стиле современных AI-чатов.

Layout:

```text
┌───────────────┬──────────────────────────┐
│               │                          │
│   New Chat    │         Chat             │
│               │                          │
│ Chat 1        │ user                     │
│ Chat 2        │ hello                    │
│ Chat 3        │                          │
│               │ assistant                │
│               │ hello!                   │
│               │                          │
│               │                          │
│               ├──────────────────────────┤
│               │ [ message... ]   [Send] │
└───────────────┴──────────────────────────┘
```

В sidebar:

- New Chat;
- история чатов;
- удаление чата.

Над input:

```text
Model: [ Auto ▼ ]

Skill: [ Auto / None / code-review ▼ ]
```

Для ответа желательно отображать небольшую metadata:

```text
Qwen Coder 30B
2.8 sec
```

Tool calls показывать сворачиваемыми блоками.

Например:

```text
▶ gitlab_search

▶ filesystem_read_file
```

## 15. Streaming events

Не передавать frontend просто сырой текст.

Определить внутренний event protocol.

Например:

```ts
type AgentEvent =
    | {
        type: "run.started";
        provider: string;
        model: string;
    }
    | {
        type: "text.delta";
        text: string;
    }
    | {
        type: "tool.started";
        tool: string;
        arguments: unknown;
    }
    | {
        type: "tool.completed";
        tool: string;
        result: unknown;
    }
    | {
        type: "run.completed";
        usage?: TokenUsage;
    }
    | {
        type: "run.error";
        message: string;
    };
```

Frontend должен работать с этим protocol, а не с API конкретного LLM provider.

## 16. Структура проекта

Предпочтительная структура:

```text
llm-agent/
│
├── apps/
│   ├── api/
│   └── web/
│
├── packages/
│   ├── agent-core/
│   │   ├── runtime/
│   │   ├── context/
│   │   ├── router/
│   │   └── types/
│   │
│   ├── providers/
│   │   ├── openai-compatible/
│   │   └── anthropic/
│   │
│   ├── skills/
│   │
│   ├── tools/
│   │
│   ├── mcp/
│   │
│   └── storage/
│
├── skills/
│   ├── code-review/
│   │   └── SKILL.md
│   └── research/
│       └── SKILL.md
│
├── config/
│   ├── providers.yaml
│   ├── routing.yaml
│   └── mcp.json
│
├── .env.example
├── package.json
└── README.md
```

Использовать npm workspaces.

Не создавать лишние packages, если это существенно усложняет MVP.

## 17. Error handling

Корректно обрабатывать:

- provider unavailable;
- timeout;
- invalid API key;
- MCP server unavailable;
- MCP tool error;
- malformed tool arguments;
- превышение tool iteration limit;
- network errors;
- пользователь остановил generation.

Ошибка одного MCP server не должна ломать запуск всего приложения.

## 18. Logging

Добавить структурированные логи для:

```text
agent run
provider selection
LLM request
LLM response
tool call
MCP connection
errors
```

Не логировать API keys.

Не логировать secrets из environment variables.

## 19. Безопасность

MCP tools потенциально опасны.

Не выполнять произвольные shell-команды напрямую из текста ответа модели.

Tool может быть выполнен только если он зарегистрирован в ToolRegistry.

Добавить возможность в будущем определить:

```text
safe
approval-required
disabled
```

Для MVP достаточно подготовить соответствующее поле в Tool metadata.

## 20. Тестирование

Особое внимание уделить unit tests для:

```text
ProviderRouter
SkillRegistry
ContextBuilder
ToolRegistry
AgentRuntime tool loop
```

LLM API в unit tests мокировать.

MCP servers в unit tests мокировать.

Не требовать реального OpenAI/Anthropic API для запуска тестов.

## 21. Принципы реализации

Следовать следующим принципам:

- SOLID;
- dependency inversion;
- маленькие специализированные модули;
- строгая TypeScript типизация;
- минимум `any`;
- Composition API во Vue;
- `<script setup>`;
- provider-agnostic AgentRuntime;
- tool-agnostic AgentRuntime;
- конфигурация вместо hardcode;
- YAGNI.

Не создавать абстракции без практической необходимости.

Если простой интерфейс решает задачу — использовать простой интерфейс.

## 22. Что НЕ нужно делать в первой версии

Не реализовывать пока:

- multi-user;
- authentication;
- billing;
- vector database;
- RAG;
- embeddings;
- long-term memory;
- subagents;
- multi-agent orchestration;
- workflow designer;
- browser automation;
- voice;
- image generation;
- сложный permission system;
- Kubernetes;
- microservices.

Но архитектура не должна мешать добавить некоторые из этих возможностей позже.

## 23. MVP Definition of Done

MVP считается готовым, если можно:

1. запустить backend;
2. запустить Vue frontend;
3. создать чат;
4. отправить сообщение;
5. увидеть streaming-ответ;
6. закрыть приложение;
7. открыть приложение;
8. продолжить сохраненный чат;
9. выбрать другую модель;
10. использовать Auto provider routing;
11. загрузить SKILL.md;
12. использовать skill в запросе;
13. подключить хотя бы один MCP server;
14. увидеть MCP tools;
15. позволить модели вызвать MCP tool;
16. увидеть tool call в UI;
17. получить финальный ответ после выполнения tool;
18. посмотреть provider/model, использованные для run.

## 24. Порядок реализации

Не пытаться реализовать всё одновременно.

Работать итеративно:

```text
Phase 1
Chat + SQLite + OpenAI-compatible provider + streaming

Phase 2
Provider abstraction + несколько моделей

Phase 3
ProviderRouter

Phase 4
Skills

Phase 5
ToolRegistry

Phase 6
MCP

Phase 7
Tool loop

Phase 8
UI для models / skills / tools

Phase 9
Tests + error handling + cleanup
```

После каждой фазы приложение должно оставаться запускаемым.

## 25. Требования к работе coding agent

Перед написанием кода:

1. изучи существующую структуру проекта;
2. проверь `package.json`;
3. проверь существующие conventions;
4. составь короткий implementation plan;
5. перечисли файлы, которые собираешься создать/изменить.

Если проект пустой — сначала предложи минимальную структуру.

Не переписывай существующий код без необходимости.

Не добавляй dependency, если задача решается стандартными средствами или уже установленной библиотекой.

После каждого значительного этапа:

1. запусти TypeScript typecheck;
2. запусти lint;
3. запусти tests;
4. исправь обнаруженные ошибки.

Не заявляй, что задача работает, если соответствующая проверка не была выполнена.

При архитектурном выборе отдавай предпочтение наиболее простому решению, которое не блокирует следующие этапы.

Главный приоритет:

**сначала рабочий минимальный agent runtime, затем расширяемость.**