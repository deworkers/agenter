const readTools = new Set([
  "list_commits", "get_commit", "get_commit_diff", "list_commit_statuses",
  "list_merge_requests", "get_merge_request", "get_merge_request_diffs",
  "list_merge_request_changed_files", "list_merge_request_diffs", "get_merge_request_file_diff",
  "list_merge_request_versions", "get_merge_request_version", "get_branch_diffs",
  "mr_discussions", "get_merge_request_notes", "get_merge_request_note",
  "get_merge_request_approval_state", "get_merge_request_conflicts", "list_merge_request_pipelines",
  "get_file_contents", "get_repository_tree", "get_file_blame", "get_branch", "list_branches",
  "search_repositories", "list_projects", "get_project", "list_group_projects",
  "list_issues", "get_issue", "list_issue_discussions", "health_check", "whoami",
]);

const writeFields: Record<string, string[]> = {
  update_merge_request: ["project_id", "merge_request_iid", "description"],
  create_merge_request_note: ["project_id", "merge_request_iid", "body"],
  create_merge_request_thread: ["project_id", "merge_request_iid", "body", "position"],
  create_merge_request_discussion_note: ["project_id", "merge_request_iid", "discussion_id", "body"],
};

export function isGitlabReviewTool(name: string): boolean {
  return readTools.has(name) || Object.hasOwn(writeFields, name);
}

export function gitlabReviewSchema(name: string, schema: Record<string, unknown>): Record<string, unknown> {
  const fields = writeFields[name];
  if (!fields) return schema;
  const original = schema.properties as Record<string, unknown> | undefined;
  const properties = Object.fromEntries(fields.map(field => [field,
    field === "position" ? (original?.position ?? { type: "object" }) : {
      type: "string", minLength: 1,
      description: field === "description" || field === "body"
        ? "Plain Markdown text. Lines starting with / are prohibited; GitLab quick actions are not allowed."
        : field === "project_id" ? "Project ID or namespace/project path" : field === "merge_request_iid" ? "Merge request IID" : "Existing discussion ID",
    },
  ]));
  return { type: "object", properties, required: fields.filter(field => field !== "position"), additionalProperties: false };
}

export function validateGitlabReviewCall(name: string, args: unknown): void {
  if (!isGitlabReviewTool(name)) throw new RangeError("Инструмент запрещён профилем GitLab review");
  const fields = writeFields[name];
  if (!fields) return;
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new RangeError("Ожидаются параметры записи GitLab");
  const input = args as Record<string, unknown>;
  if (Object.keys(input).some(field => !fields.includes(field))) throw new RangeError("Профиль GitLab review запрещает эти параметры записи");
  for (const field of fields.filter(field => field !== "position")) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new RangeError(`Укажите ${field}`);
  }
  if (input.position !== undefined && (input.position === null || typeof input.position !== "object" || Array.isArray(input.position))) throw new RangeError("Некорректная позиция комментария");
  const text = (input.description ?? input.body) as string;
  if (text.split(/[\r\n]/u).some(line => line.trimStart().startsWith("/"))) {
    throw new RangeError("Команды GitLab quick actions в описаниях и комментариях запрещены");
  }
}
