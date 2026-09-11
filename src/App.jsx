import React, { useState, useEffect } from "react";
import "./App.css";
import iconPng from "./EvalBuilder-icon.png";

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 9);

const defaultRole = (profile) =>
  `You are an expert reviewer evaluating responses for ${profile.name}.`;

const defaultContext = (profile) =>
  `Users: ${profile.users}. Brand tone: ${profile.tone}. Non-negotiable: ${profile.nonNegotiables}`;

const getFinalOutput = (trace) => {
  if (!trace.spans.length) return "";
  return trace.spans[trace.spans.length - 1].output || "";
};

const makeEmptyDraft = (profile) => ({
  id: null,
  name: "",
  sourceTraceId: null,
  role: defaultRole(profile),
  context: defaultContext(profile),
  goalCriteria: [""],
  typeChoice: null,
  codeCheckType: null,
  codeCheckConfig: {},
  labels: [
    { score: 3, label: "Pass", definition: "" },
    { score: 1, label: "Fail", definition: "" },
  ],
  scopeAll: true,
  scopeIntents: [],
});

function runCodeCheck(ev, traces) {
  const scoped = ev.scopeAll
    ? traces
    : traces.filter((t) => ev.scopeIntents.includes(t.intent));

  const results = scoped.map((t) => {
    let passed = false;
    let detail = "";
    const output = getFinalOutput(t);
    try {
      if (ev.codeCheckType === "tool_call") {
        const name = ev.codeCheckConfig.toolName || "";
        passed = t.spans.some((s) => s.type === "tool_call" && s.name === name);
        detail = passed ? `called ${name}` : `did not call ${name}`;
      } else if (ev.codeCheckType === "substring") {
        const sub = ev.codeCheckConfig.substring || "";
        passed = output.toLowerCase().includes(sub.toLowerCase());
        detail = passed ? `found "${sub}"` : `missing "${sub}"`;
      } else if (ev.codeCheckType === "regex") {
        const pattern = ev.codeCheckConfig.pattern || "";
        const re = new RegExp(pattern, "i");
        passed = re.test(output);
        detail = passed ? "pattern matched" : "pattern did not match";
      } else if (ev.codeCheckType === "json_valid") {
        JSON.parse(output);
        passed = true;
        detail = "valid JSON";
      }
    } catch (e) {
      passed = false;
      detail = ev.codeCheckType === "regex" ? "invalid regex" : "not valid JSON";
    }
    return { traceId: t.id, traceTitle: t.title, passed, detail };
  });

  const passRate = results.length
    ? Math.round((results.filter((r) => r.passed).length / results.length) * 100)
    : 0;

  return { results, passRate };
}

// ---------- export helpers ----------
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function evalToExportObject(ev) {
  return {
    id: ev.id,
    name: ev.name,
    type: ev.type,
    role: ev.role,
    context: ev.context,
    goal: ev.goalCriteria,
    scope: { all: ev.scopeAll, intents: ev.scopeIntents },
    check: ev.type === "code" ? { type: ev.codeCheckType, config: ev.codeCheckConfig } : null,
    labels: ev.type === "judge" ? ev.labels : [],
    sourceTraceId: ev.sourceTraceId,
  };
}

function evalsToCSV(evals) {
  const header = [
    "id", "name", "type", "role", "context", "goal",
    "scope_all", "scope_intents", "check_type", "check_config", "labels", "sourceTraceId",
  ];
  const rows = evals.map((ev) => {
    const exp = evalToExportObject(ev);
    return [
      exp.id,
      exp.name,
      exp.type,
      exp.role,
      exp.context,
      exp.goal.join(" | "),
      exp.scope.all,
      exp.scope.intents.join(","),
      exp.check ? exp.check.type : "",
      exp.check ? JSON.stringify(exp.check.config) : "",
      exp.labels.length ? JSON.stringify(exp.labels) : "",
      exp.sourceTraceId || "",
    ].map(csvEscape).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

function resultsToCSV(evalName, outcome) {
  const header = ["eval_name", "trace_id", "trace_title", "passed", "detail"];
  const rows = outcome.results.map((r) =>
    [evalName, r.traceId, r.traceTitle, r.passed, r.detail].map(csvEscape).join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

// ---------- seed data ----------
const seedTraces = [
  {
    id: "t1",
    title: "Duplicate charge complaint",
    userInput: "Why was I charged twice this month for my subscription?",
    intent: "billing_dispute",
    spans: [
      {
        id: uid(),
        type: "tool_call",
        name: "lookup_billing_history",
        input: '{"account_id":"A-4471"}',
        output:
          '{"charges":[{"date":"2026-09-01","amount":14.99},{"date":"2026-09-01","amount":14.99}]}',
      },
      {
        id: uid(),
        type: "tool_call",
        name: "lookup_refund_policy",
        input: '{"reason":"duplicate_charge"}',
        output: '{"eligible":true,"window_days":3}',
      },
      {
        id: uid(),
        type: "model_response",
        name: "Final response",
        input: null,
        output:
          "I can see one charge of $14.99 on September 1st. That looks correct to me, let me know if you have other questions.",
      },
    ],
    failureTags: ["duplicate_data_not_caught"],
  },
  {
    id: "t2",
    title: "Restock timing missed",
    userInput: "Do you have the size 9 hiking boots in stock?",
    intent: "inventory_question",
    spans: [
      {
        id: uid(),
        type: "tool_call",
        name: "lookup_inventory",
        input: '{"sku":"HB-9-BRN"}',
        output: '{"in_stock":false,"restock_date":"2026-09-22"}',
      },
      {
        id: uid(),
        type: "model_response",
        name: "Final response",
        input: null,
        output: "Unfortunately size 9 is currently out of stock.",
      },
    ],
    failureTags: ["incomplete_answer"],
  },
  {
    id: "t3",
    title: "Condescending tone on setup help",
    userInput: "I can't figure out how to reset my password, this is so confusing",
    intent: "account_help",
    spans: [
      {
        id: uid(),
        type: "model_response",
        name: "Final response",
        input: null,
        output:
          "It's actually a very simple process, just click the obvious 'forgot password' link like everyone else does.",
      },
    ],
    failureTags: ["tone_mismatch"],
  },
  {
    id: "t4",
    title: "Clean billing resolution",
    userInput: "I was charged twice, can you fix it?",
    intent: "billing_dispute",
    spans: [
      {
        id: uid(),
        type: "tool_call",
        name: "lookup_billing_history",
        input: '{"account_id":"A-5820"}',
        output: '{"charges":[{"date":"2026-09-03","amount":14.99},{"date":"2026-09-03","amount":14.99}]}',
      },
      {
        id: uid(),
        type: "tool_call",
        name: "lookup_refund_policy",
        input: '{"reason":"duplicate_charge"}',
        output: '{"eligible":true,"window_days":3}',
      },
      {
        id: uid(),
        type: "model_response",
        name: "Final response",
        input: null,
        output:
          "I found two charges of $14.99 on the same day, that's a duplicate. I've submitted a refund for the extra charge, you'll see it within 3 business days.",
      },
    ],
    failureTags: [],
  },
];

const seedTaxonomy = [
  "hallucination",
  "tone_mismatch",
  "incomplete_answer",
  "wrong_tool_call",
  "duplicate_data_not_caught",
  "missed_context",
  "compliance_issue",
];

const seedProfile = {
  name: "Support Copilot",
  users: "B2C subscribers contacting support over chat",
  tone: "Direct and warm, never condescending or corporate",
  nonNegotiables:
    "Never promise a refund amount before the policy lookup confirms eligibility",
};

const seedEvals = [
  {
    id: "e1",
    name: "Refund policy checked before billing response",
    sourceTraceId: "t1",
    role: defaultRole(seedProfile),
    context: defaultContext(seedProfile),
    goalCriteria: [
      "Agent calls lookup_refund_policy before responding to any billing dispute",
    ],
    type: "code",
    codeCheckType: "tool_call",
    codeCheckConfig: { toolName: "lookup_refund_policy" },
    labels: [],
    scopeAll: false,
    scopeIntents: ["billing_dispute"],
  },
  {
    id: "e2",
    name: "Tone matches brand voice",
    sourceTraceId: "t3",
    role: "You are an expert support-quality reviewer for a consumer subscription product.",
    context:
      "Our support agent talks to everyday consumers who are often frustrated. Brand tone is direct and warm, never condescending or corporate.",
    goalCriteria: [
      "Does the response acknowledge the user's frustration without being dismissive?",
      "Is the tone warm rather than curt or condescending?",
    ],
    type: "judge",
    codeCheckType: null,
    codeCheckConfig: {},
    labels: [
      { score: 3, label: "On-brand", definition: "Warm, direct, acknowledges the user." },
      { score: 2, label: "Flat", definition: "Not rude, but robotic or generic." },
      { score: 1, label: "Off-brand", definition: "Condescending, dismissive, or corporate-sounding." },
    ],
    scopeAll: true,
    scopeIntents: [],
  },
];

const STORAGE_KEY = "eval-builder-projects";
const CURRENT_PROJECT_KEY = "eval-builder-current-project";

const cloneProjectData = (value) => JSON.parse(JSON.stringify(value));

const createProject = (name = "My Project") => ({
  id: uid(),
  name,
  profile: cloneProjectData(seedProfile),
  traces: cloneProjectData(seedTraces),
  taxonomy: cloneProjectData(seedTaxonomy),
  evals: cloneProjectData(seedEvals),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const normalizeProject = (project, index) => ({
  id: project.id || uid(),
  name: project.name || `Project ${index + 1}`,
  profile: project.profile || cloneProjectData(seedProfile),
  traces: Array.isArray(project.traces) ? project.traces : cloneProjectData(seedTraces),
  taxonomy: Array.isArray(project.taxonomy) ? project.taxonomy : cloneProjectData(seedTaxonomy),
  evals: Array.isArray(project.evals) ? project.evals : cloneProjectData(seedEvals),
  createdAt: project.createdAt || Date.now(),
  updatedAt: project.updatedAt || Date.now(),
});

const loadProjects = () => {
  if (typeof window === "undefined") return [createProject("My Project")];

  try {
    const savedProjects = window.localStorage.getItem(STORAGE_KEY);
    if (!savedProjects) return [createProject("My Project")];

    const parsedProjects = JSON.parse(savedProjects);
    if (!Array.isArray(parsedProjects) || parsedProjects.length === 0) {
      return [createProject("My Project")];
    }

    return parsedProjects.map(normalizeProject);
  } catch {
    return [createProject("My Project")];
  }
};

// ---------- Product profile panel ----------
function ProfilePanel({ profile, setProfile }) {
  return (
    <div className="eb-profile-panel">
      <div>
        <label className="eb-field-label">Product name</label>
        <input
          className="eb-input"
          value={profile.name}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
        />
      </div>
      <div>
        <label className="eb-field-label">Users</label>
        <input
          className="eb-input"
          value={profile.users}
          onChange={(e) => setProfile({ ...profile, users: e.target.value })}
        />
      </div>
      <div>
        <label className="eb-field-label">Brand tone</label>
        <input
          className="eb-input"
          value={profile.tone}
          onChange={(e) => setProfile({ ...profile, tone: e.target.value })}
        />
      </div>
      <div>
        <label className="eb-field-label">Non-negotiable</label>
        <input
          className="eb-input"
          value={profile.nonNegotiables}
          onChange={(e) => setProfile({ ...profile, nonNegotiables: e.target.value })}
        />
      </div>
    </div>
  );
}

// ---------- guidance: hints, help notes, glossary ----------
function FieldLabel({ text, hint }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="eb-field-label-row">
        <label className="eb-field-label eb-field-label--compact">
          {text}
        </label>
        {hint && (
          <button
            type="button"
            className="eb-hint-btn"
            onClick={() => setOpen((o) => !o)}
            aria-label={`what is ${text}`}
          >
            ?
          </button>
        )}
      </div>
      {open && hint && <div className="eb-hint-bubble">{hint}</div>}
    </div>
  );
}

function HelpNote({ children }) {
  return <div className="eb-help-note">{children}</div>;
}

const GLOSSARY = [
  { term: "Trace", def: "The full record of one agent interaction: what the user said, every tool call, and the final response. It's the source of truth for what actually happened." },
  { term: "Span", def: "One step inside a trace, such as a single tool call or the model's final response." },
  { term: "Failure tag", def: "A short label describing a specific way a response went wrong. Tagging traces over time builds a taxonomy you can measure against." },
  { term: "Code-based eval", def: "A check written as exact logic: a required tool call, a substring, a regex, or valid JSON. Fast, cheap, and reproducible, but can't judge open-ended quality." },
  { term: "LLM-as-judge eval", def: "A check where a second model scores the response against a rubric. Needed for subjective quality like tone, helpfulness, or groundedness, but it needs calibration against human review before you trust it at scale." },
  { term: "Role, Context, Goal, Labels", def: "The four-part framework behind every eval here: who's judging, what they need to know, exactly what they're checking, and what each score means." },
  { term: "Scope", def: "Which traces or intents an eval applies to. Narrower scope usually means a more meaningful eval." },
  { term: "Pass rate", def: "The share of scoped traces that met an eval's criteria on the last run." },
];

function HelpModal({ onClose }) {
  return (
    <div className="eb-modal-backdrop" onClick={onClose}>
      <div className="eb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eb-modal-head">
          <h3 className="eb-serif eb-heading-reset">Guide</h3>
          <button className="eb-modal-close" onClick={onClose} aria-label="close guide">
            ×
          </button>
        </div>
        <p className="eb-section-sub eb-section-sub-tight">
          Short definitions for the concepts this tool is built around.
        </p>
        <dl>
          {GLOSSARY.map((g) => (
            <div className="eb-glossary-term" key={g.term}>
              <dt>{g.term}</dt>
              <dd>{g.def}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ---------- Projects tab ----------
function ProjectsTab({
  projects,
  currentProjectId,
  onCreateProject,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
}) {
  const [name, setName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingName, setEditingName] = useState("");

  const beginRename = (project) => {
    setEditingProjectId(project.id);
    setEditingName(project.name);
  };

  const cancelRename = () => {
    setEditingProjectId(null);
    setEditingName("");
  };

  const saveRename = (projectId) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;

    onRenameProject(projectId, trimmed);
    cancelRename();
  };

  return (
    <div>
      <div className="eb-row-between">
        <div>
          <h2 className="eb-section-title eb-serif">Projects</h2>
          <p className="eb-section-sub">
            Create a project to gather traces, evals, and settings for a specific initiative.
          </p>
        </div>
      </div>

      <div className="eb-panel">
        <label className="eb-field-label">Project name</label>
        <div className="eb-row">
          <input
            className="eb-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Support Copilot quality review"
          />
          <button
            className="eb-btn"
            onClick={() => {
              const trimmed = name.trim();
              const createdProject = onCreateProject(trimmed || "Untitled project");
              setName("");

              if (createdProject) {
                setEditingProjectId(createdProject.id);
                setEditingName(createdProject.name);
              }
            }}
          >
            Create project
          </button>
        </div>
      </div>

      {projects.map((project) => (
        <div
          className={`eb-project-card ${project.id === currentProjectId ? "selected" : ""}`}
          key={project.id}
        >
          {editingProjectId === project.id ? (
            <div className="eb-project-editing">
              <input
                className="eb-input"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                autoFocus
              />
              <div className="eb-project-actions">
                <button className="eb-btn eb-btn-sm" onClick={() => saveRename(project.id)}>
                  Save
                </button>
                <button className="eb-btn-outline eb-btn-sm" onClick={cancelRename}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <button
                  type="button"
                  className="eb-project-name-btn"
                  onClick={() => beginRename(project)}
                >
                  {project.name}
                </button>
                <p className="eb-project-meta">
                  {project.traces.length} traces • {project.evals.length} evals • updated {new Date(project.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="eb-project-actions">
                <button className="eb-btn-outline eb-btn-sm" onClick={() => onOpenProject(project.id)}>
                  {project.id === currentProjectId ? "Current project" : "Open"}
                </button>
                <button className="eb-btn-outline eb-btn-sm" onClick={() => beginRename(project)}>
                  Rename
                </button>
                <button className="eb-btn-outline eb-btn-sm" onClick={() => onDeleteProject(project.id)}>
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- Traces tab ----------
function TracesTab({ traces, setTraces, taxonomy, setTaxonomy, onBuildFromTrace }) {
  const [newTagInputs, setNewTagInputs] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ title: "", userInput: "", intent: "", response: "" });

  const addTag = (traceId, tag) => {
    const clean = tag.trim();
    if (!clean) return;
    setTraces((prev) =>
      prev.map((t) =>
        t.id === traceId && !t.failureTags.includes(clean)
          ? { ...t, failureTags: [...t.failureTags, clean] }
          : t
      )
    );
    if (!taxonomy.includes(clean)) setTaxonomy((prev) => [...prev, clean]);
    setNewTagInputs((prev) => ({ ...prev, [traceId]: "" }));
  };

  const removeTag = (traceId, tag) => {
    setTraces((prev) =>
      prev.map((t) =>
        t.id === traceId ? { ...t, failureTags: t.failureTags.filter((x) => x !== tag) } : t
      )
    );
  };

  const submitTrace = () => {
    if (!form.title.trim() || !form.userInput.trim()) return;
    const newTrace = {
      id: uid(),
      title: form.title,
      userInput: form.userInput,
      intent: form.intent.trim() || "uncategorized",
      spans: [
        {
          id: uid(),
          type: "model_response",
          name: "Final response",
          input: null,
          output: form.response,
        },
      ],
      failureTags: [],
    };
    setTraces((prev) => [newTrace, ...prev]);
    setForm({ title: "", userInput: "", intent: "", response: "" });
    setShowAddForm(false);
  };

  return (
    <div>
      <div className="eb-row-between">
        <div>
          <h2 className="eb-section-title eb-serif">Traces</h2>
          <p className="eb-section-sub">
            Review real interactions, tag what went wrong, and send the worst ones straight into an eval.
          </p>
        </div>
        <button className="eb-btn-outline" onClick={() => setShowAddForm((s) => !s)}>
          {showAddForm ? "Cancel" : "+ Add trace"}
        </button>
      </div>

      <HelpNote>
        <strong>A trace</strong> is the full record of one interaction: what the user said, every tool call the agent made, and its final response. Each step below is a <strong>span</strong>. Tag the ones that went wrong, patterns across tags become your failure taxonomy, and the taxonomy becomes your eval backlog.
      </HelpNote>

      {showAddForm && (
        <div className="eb-panel">
          <label className="eb-field-label">Title</label>
          <input
            className="eb-input eb-mb-10"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Short label for this trace"
          />
          <label className="eb-field-label">User input</label>
          <textarea
            className="eb-textarea eb-mb-10"
            value={form.userInput}
            onChange={(e) => setForm({ ...form, userInput: e.target.value })}
          />
          <label className="eb-field-label">Intent</label>
          <input
            className="eb-input eb-mb-10"
            value={form.intent}
            onChange={(e) => setForm({ ...form, intent: e.target.value })}
            placeholder="e.g. billing_dispute"
          />
          <label className="eb-field-label">Agent response</label>
          <textarea
            className="eb-textarea eb-mb-14"
            value={form.response}
            onChange={(e) => setForm({ ...form, response: e.target.value })}
          />
          <button className="eb-btn" onClick={submitTrace}>
            Save trace
          </button>
        </div>
      )}

      {traces.map((t) => (
        <div className="eb-panel" key={t.id}>
          <div className="eb-panel-header">
            <div>
              <p className="eb-trace-title">{t.title}</p>
              <p className="eb-trace-meta">intent: {t.intent}</p>
            </div>
            <button className="eb-btn eb-btn-sm" onClick={() => onBuildFromTrace(t)}>
              Build eval from this →
            </button>
          </div>

          <p className="eb-quote">"{t.userInput}"</p>

          {t.spans.map((s) => (
            <div className={`eb-span ${s.type}`} key={s.id}>
              <div className={`eb-span-kind ${s.type}`}>
                {s.type === "tool_call" ? `tool call · ${s.name}` : s.name}
              </div>
              {s.input && <div className="eb-span-io">in: {s.input}</div>}
              <div className="eb-span-io">out: {s.output}</div>
            </div>
          ))}

          <div className="eb-tags">
            {t.failureTags.map((tag) => (
              <span className="eb-chip tagged" key={tag}>
                {tag}
                <button onClick={() => removeTag(t.id, tag)} aria-label={`remove ${tag}`}>
                  ×
                </button>
              </span>
            ))}
            {t.failureTags.length === 0 && (
              <span className="eb-trace-meta">no failure tags yet</span>
            )}
          </div>

          <FieldLabel
            text="Tag this trace"
            hint="Use an existing tag to keep the taxonomy consistent across traces. Add a new one only if this is a failure mode you haven't tagged before."
          />
          <div className="eb-add-tag">
            <select
              className="eb-select"
              value=""
              onChange={(e) => e.target.value && addTag(t.id, e.target.value)}
            >
              <option value="">apply existing tag…</option>
              {taxonomy
                .filter((tag) => !t.failureTags.includes(tag))
                .map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
            </select>
            <input
              className="eb-input eb-max-160"
              placeholder="new tag name"
              value={newTagInputs[t.id] || ""}
              onChange={(e) => setNewTagInputs((prev) => ({ ...prev, [t.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTag(t.id, newTagInputs[t.id] || "");
              }}
            />
            <button
              className="eb-btn-outline eb-btn-sm"
              onClick={() => addTag(t.id, newTagInputs[t.id] || "")}
            >
              add
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Build Eval wizard ----------
function BuildEvalTab({ draft, setDraft, traces, onReset, onSave }) {
  const [step, setStep] = useState(0);
  const totalSteps = 6;

  useEffect(() => {
    setStep(0);
  }, [draft.__resetKey]);

  const intents = [...new Set(traces.map((t) => t.intent))];

  const updateCriterion = (i, value) => {
    const next = [...draft.goalCriteria];
    next[i] = value;
    setDraft({ ...draft, goalCriteria: next });
  };
  const addCriterion = () => setDraft({ ...draft, goalCriteria: [...draft.goalCriteria, ""] });
  const removeCriterion = (i) =>
    setDraft({ ...draft, goalCriteria: draft.goalCriteria.filter((_, idx) => idx !== i) });

  const updateLabel = (i, field, value) => {
    const next = [...draft.labels];
    next[i] = { ...next[i], [field]: value };
    setDraft({ ...draft, labels: next });
  };
  const addLabel = () =>
    setDraft({ ...draft, labels: [...draft.labels, { score: "", label: "", definition: "" }] });
  const removeLabel = (i) =>
    setDraft({ ...draft, labels: draft.labels.filter((_, idx) => idx !== i) });

  const toggleIntent = (intent) => {
    const has = draft.scopeIntents.includes(intent);
    setDraft({
      ...draft,
      scopeIntents: has
        ? draft.scopeIntents.filter((x) => x !== intent)
        : [...draft.scopeIntents, intent],
    });
  };

  const canNext = () => {
    if (step === 0) return draft.name.trim().length > 0;
    if (step === 1) return draft.role.trim().length > 0 && draft.context.trim().length > 0;
    if (step === 2) return draft.goalCriteria.some((c) => c.trim().length > 0);
    if (step === 3) {
      if (draft.typeChoice === "code") {
        if (draft.codeCheckType === "tool_call") return !!draft.codeCheckConfig.toolName;
        if (draft.codeCheckType === "substring") return !!draft.codeCheckConfig.substring;
        if (draft.codeCheckType === "regex") return !!draft.codeCheckConfig.pattern;
        if (draft.codeCheckType === "json_valid") return true;
        return false;
      }
      if (draft.typeChoice === "judge") {
        return draft.labels.every((l) => l.label.trim() && String(l.score).trim());
      }
      return false;
    }
    if (step === 4) return draft.scopeAll || draft.scopeIntents.length > 0;
    return true;
  };

  const handleSave = () => {
    const newEval = {
      id: uid(),
      name: draft.name,
      sourceTraceId: draft.sourceTraceId,
      role: draft.role,
      context: draft.context,
      goalCriteria: draft.goalCriteria.filter((c) => c.trim()),
      type: draft.typeChoice,
      codeCheckType: draft.typeChoice === "code" ? draft.codeCheckType : null,
      codeCheckConfig: draft.typeChoice === "code" ? draft.codeCheckConfig : {},
      labels: draft.typeChoice === "judge" ? draft.labels : [],
      scopeAll: draft.scopeAll,
      scopeIntents: draft.scopeIntents,
    };
    onSave(newEval);
  };

  return (
    <div>
      <div className="eb-row-between">
        <div>
          <h2 className="eb-section-title eb-serif">Build an eval</h2>
          <p className="eb-section-sub">Role, context, goal, and labels — the four parts that make a rubric consistent.</p>
        </div>
        <button className="eb-btn-outline" onClick={onReset}>
          Start blank
        </button>
      </div>

      <div className="eb-step-track">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`eb-step-dot ${i < step ? "done" : ""} ${i === step ? "current" : ""}`}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="eb-panel">
          <HelpNote>
            Every eval checks one job. If you find yourself naming this "and" something else, it's probably two evals.
          </HelpNote>
          <FieldLabel text="Eval name" hint="A short, specific label. You'll see this in the Library, so name it after the failure or behavior it checks, not the feature." />
          <input
            className="eb-input eb-mb-12"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Refund policy checked before billing response"
          />
          {draft.sourceTraceId && (
            <p className="eb-trace-meta">
              Prefilled from trace: {traces.find((t) => t.id === draft.sourceTraceId)?.title}
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="eb-panel">
          <FieldLabel
            text="Role — who is judging, and from what perspective"
            hint={'Example: "You are an expert customer service evaluator with 10+ years at enterprise software companies." This sets the lens quality gets judged through.'}
          />
          <textarea
            className="eb-textarea eb-mb-14"
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
          />
          <FieldLabel
            text="Context — product, users, brand, constraints"
            hint="Background the judge wouldn't otherwise have: who the users are, what tone matters, and anything that's non-negotiable. This pulls from your product profile by default."
          />
          <textarea
            className="eb-textarea"
            value={draft.context}
            onChange={(e) => setDraft({ ...draft, context: e.target.value })}
          />
        </div>
      )}

      {step === 2 && (
        <div className="eb-panel">
          <FieldLabel
            text="Goal — what exactly are you checking for"
            hint="Be specific. One criterion per line — vague goals like 'is it good' produce inconsistent scores, whether a human or a model is grading."
          />
          {draft.goalCriteria.map((c, i) => (
            <div className="eb-criterion-row" key={i}>
              <input
                className="eb-input"
                value={c}
                onChange={(e) => updateCriterion(i, e.target.value)}
                placeholder="One specific criterion"
              />
              {draft.goalCriteria.length > 1 && (
                <button className="eb-btn-outline eb-btn-sm" onClick={() => removeCriterion(i)}>
                  remove
                </button>
              )}
            </div>
          ))}
          <button className="eb-textlink" onClick={addCriterion}>
            + add another criterion
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="eb-panel">
          <HelpNote>
            If two careful humans would always agree on the answer without discussion, it's objective. If they might reasonably disagree, it needs judgment.
          </HelpNote>
          <label className="eb-field-label">
            Can this be checked with exact logic, or does it need judgment?
          </label>
          <div className="eb-type-options">
            <button
              className={`eb-type-card ${draft.typeChoice === "code" ? "selected" : ""}`}
              onClick={() => setDraft({ ...draft, typeChoice: "code" })}
            >
              <h4>Objective / rule-based</h4>
              <p>A specific tool call, a required string, a regex, valid JSON. Fast, cheap, runs on every trace.</p>
            </button>
            <button
              className={`eb-type-card ${draft.typeChoice === "judge" ? "selected" : ""}`}
              onClick={() => setDraft({ ...draft, typeChoice: "judge" })}
            >
              <h4>Subjective / judgment call</h4>
              <p>Tone, helpfulness, groundedness. Needs a rubric and, eventually, an LLM judge calibrated against a human.</p>
            </button>
          </div>

          {draft.typeChoice === "code" && (
            <div>
              <label className="eb-field-label">Check type</label>
              <div className="eb-check-grid">
                {[
                  { key: "tool_call", label: "Tool call required" },
                  { key: "substring", label: "Required substring" },
                  { key: "regex", label: "Regex match" },
                  { key: "json_valid", label: "JSON valid" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    className={`eb-check-btn ${draft.codeCheckType === opt.key ? "selected" : ""}`}
                    onClick={() =>
                      setDraft({ ...draft, codeCheckType: opt.key, codeCheckConfig: {} })
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {draft.codeCheckType === "tool_call" && (
                <input
                  className="eb-input"
                  placeholder="tool name, e.g. lookup_refund_policy"
                  value={draft.codeCheckConfig.toolName || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      codeCheckConfig: { ...draft.codeCheckConfig, toolName: e.target.value },
                    })
                  }
                />
              )}
              {draft.codeCheckType === "substring" && (
                <input
                  className="eb-input"
                  placeholder="required substring in the final response"
                  value={draft.codeCheckConfig.substring || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      codeCheckConfig: { ...draft.codeCheckConfig, substring: e.target.value },
                    })
                  }
                />
              )}
              {draft.codeCheckType === "regex" && (
                <input
                  className="eb-input"
                  placeholder="regex pattern, e.g. \\brefund\\b"
                  value={draft.codeCheckConfig.pattern || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      codeCheckConfig: { ...draft.codeCheckConfig, pattern: e.target.value },
                    })
                  }
                />
              )}
              {draft.codeCheckType === "json_valid" && (
                <p className="eb-trace-meta">Checks that the final response parses as valid JSON.</p>
              )}
            </div>
          )}

          {draft.typeChoice === "judge" && (
            <div>
              <FieldLabel
                text="Labels — define what each score means"
                hint="Write a definition specific enough that two reviewers would land on the same score without talking to each other. That specificity is what makes an LLM judge trustworthy later."
              />
              {draft.labels.map((l, i) => (
                <div className="eb-criterion-row" key={i}>
                  <input
                    className="eb-input eb-max-60"
                    value={l.score}
                    onChange={(e) => updateLabel(i, "score", e.target.value)}
                    placeholder="3"
                  />
                  <input
                    className="eb-input eb-max-140"
                    value={l.label}
                    onChange={(e) => updateLabel(i, "label", e.target.value)}
                    placeholder="Label"
                  />
                  <input
                    className="eb-input"
                    value={l.definition}
                    onChange={(e) => updateLabel(i, "definition", e.target.value)}
                    placeholder="What this score means"
                  />
                  {draft.labels.length > 1 && (
                    <button className="eb-btn-outline eb-btn-sm" onClick={() => removeLabel(i)}>
                      remove
                    </button>
                  )}
                </div>
              ))}
              <button className="eb-textlink" onClick={addLabel}>
                + add another label
              </button>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="eb-panel">
          <FieldLabel
            text="Scope — which traces does this eval apply to?"
            hint="Most evals should only run against the intent they were written for. Applying a billing-specific check to every trace usually just adds noise to your pass rate."
          />
          <label className="eb-field-scope">
            <input
              type="checkbox"
              checked={draft.scopeAll}
              onChange={(e) => setDraft({ ...draft, scopeAll: e.target.checked })}
            />
            Apply to all traces
          </label>
          {!draft.scopeAll && (
            <div className="eb-intent-list">
              {intents.map((intent) => (
                <label key={intent}>
                  <input
                    type="checkbox"
                    checked={draft.scopeIntents.includes(intent)}
                    onChange={() => toggleIntent(intent)}
                  />
                  {intent}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="eb-panel">
          {draft.typeChoice === "judge" && (
            <HelpNote>
              This eval will be scored by a model, not code. Before trusting it at scale, run it against a sample of traces and compare its verdicts to a human reviewer's.
            </HelpNote>
          )}
          <div className="eb-summary-row">
            <div className="eb-summary-label">Name</div>
            <div className="eb-summary-value">{draft.name}</div>
          </div>
          <div className="eb-summary-row">
            <div className="eb-summary-label">Type</div>
            <div className="eb-summary-value">
              {draft.typeChoice === "code" ? "Code-based" : "LLM-as-judge"}
            </div>
          </div>
          <div className="eb-summary-row">
            <div className="eb-summary-label">Role</div>
            <div className="eb-summary-value">{draft.role}</div>
          </div>
          <div className="eb-summary-row">
            <div className="eb-summary-label">Context</div>
            <div className="eb-summary-value">{draft.context}</div>
          </div>
          <div className="eb-summary-row">
            <div className="eb-summary-label">Goal</div>
            <div className="eb-summary-value">
              {draft.goalCriteria.filter((c) => c.trim()).map((c, i) => (
                <div key={i}>• {c}</div>
              ))}
            </div>
          </div>
          <div className="eb-summary-row">
            <div className="eb-summary-label">
              {draft.typeChoice === "code" ? "Check" : "Labels"}
            </div>
            <div className="eb-summary-value">
              {draft.typeChoice === "code" ? (
                <span>
                  {draft.codeCheckType}: {JSON.stringify(draft.codeCheckConfig)}
                </span>
              ) : (
                draft.labels.map((l, i) => (
                  <div key={i}>
                    {l.score} = {l.label}: {l.definition}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="eb-summary-row">
            <div className="eb-summary-label">Scope</div>
            <div className="eb-summary-value">
              {draft.scopeAll ? "All traces" : draft.scopeIntents.join(", ")}
            </div>
          </div>
        </div>
      )}

      <div className="eb-wizard-nav">
        <button
          className="eb-btn-outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          ← Back
        </button>
        {step < totalSteps - 1 ? (
          <button className="eb-btn" onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>
            Next →
          </button>
        ) : (
          <button className="eb-btn" onClick={handleSave}>
            Save eval
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Library tab ----------
function LibraryTab({ evals, traces }) {
  const [expanded, setExpanded] = useState(new Set());
  const [runResults, setRunResults] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const runEval = (ev) => {
    const outcome = runCodeCheck(ev, traces);
    setRunResults((prev) => ({ ...prev, [ev.id]: outcome }));
  };

  const copyRubric = (ev) => {
    const text = [
      `Role: ${ev.role}`,
      "",
      `Context: ${ev.context}`,
      "",
      "Goal:",
      ...ev.goalCriteria.map((c) => `- ${c}`),
      "",
      "Labels:",
      ...ev.labels.map((l) => `${l.score} = ${l.label}: ${l.definition}`),
    ].join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedId(ev.id);
        setTimeout(() => setCopiedId(null), 1500);
      });
    }
  };

  if (!evals.length) {
    return (
      <div>
        <h2 className="eb-section-title eb-serif">Library</h2>
        <div className="eb-empty">No evals saved yet. Build one from the Traces or Build Eval tab.</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="eb-section-title eb-serif">Library</h2>
      <p className="eb-section-sub">
        {evals.length} eval{evals.length === 1 ? "" : "s"} saved. Run code-based checks against your traces, or copy a rubric out to your LLM judge of choice.
      </p>

      <HelpNote>
        <strong>Pass rate</strong> is the share of scoped traces that met the eval's criteria on the last run, not a lifetime average. Re-run after any prompt or tool change.
      </HelpNote>

      <div className="eb-export-row">
        <span className="eb-trace-meta eb-trace-meta--align-center eb-mr-4">
          for developers:
        </span>
        <button
          className="eb-btn-outline eb-btn-sm"
          onClick={() =>
            downloadFile(
              "evals.json",
              JSON.stringify(evals.map(evalToExportObject), null, 2),
              "application/json"
            )
          }
        >
          Export all (JSON)
        </button>
        <button
          className="eb-btn-outline eb-btn-sm"
          onClick={() => downloadFile("evals.csv", evalsToCSV(evals), "text/csv")}
        >
          Export all (CSV)
        </button>
      </div>

      {evals.map((ev) => {
        const isOpen = expanded.has(ev.id);
        const result = runResults[ev.id];
        return (
          <div className="eb-eval-card" key={ev.id}>
            <div className="eb-eval-head" onClick={() => toggleExpand(ev.id)}>
              <div className="eb-row">
                <span className="eb-eval-name">{ev.name}</span>
                <span className={`eb-badge ${ev.type}`}>
                  {ev.type === "code" ? "code-based" : "llm-as-judge"}
                </span>
              </div>
              <div className="eb-eval-actions">
                <button
                  className="eb-btn-outline eb-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadFile(
                      `${ev.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.json`,
                      JSON.stringify(evalToExportObject(ev), null, 2),
                      "application/json"
                    );
                  }}
                >
                  JSON
                </button>
                <button
                  className="eb-btn-outline eb-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadFile(
                      `${ev.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.csv`,
                      evalsToCSV([ev]),
                      "text/csv"
                    );
                  }}
                >
                  CSV
                </button>
                <span className="eb-trace-meta">{isOpen ? "hide ▲" : "show ▼"}</span>
              </div>
            </div>

            {isOpen && (
              <div className="eb-eval-body">
                <div className="eb-summary-row eb-mt-14">
                  <div className="eb-summary-label">Role</div>
                  <div className="eb-summary-value">{ev.role}</div>
                </div>
                <div className="eb-summary-row">
                  <div className="eb-summary-label">Context</div>
                  <div className="eb-summary-value">{ev.context}</div>
                </div>
                <div className="eb-summary-row">
                  <div className="eb-summary-label">Goal</div>
                  <div className="eb-summary-value">
                    {ev.goalCriteria.map((c, i) => (
                      <div key={i}>• {c}</div>
                    ))}
                  </div>
                </div>
                <div className="eb-summary-row">
                  <div className="eb-summary-label">Scope</div>
                  <div className="eb-summary-value">
                    {ev.scopeAll ? "All traces" : ev.scopeIntents.join(", ")}
                  </div>
                </div>

                {ev.type === "code" ? (
                  <div>
                    <div className="eb-summary-row">
                      <div className="eb-summary-label">Check</div>
                      <div className="eb-summary-value">
                        {ev.codeCheckType}: {JSON.stringify(ev.codeCheckConfig)}
                      </div>
                    </div>
                    <button className="eb-btn eb-btn-sm" onClick={() => runEval(ev)}>
                      Run against traces
                    </button>

                    {result && (
                      <div className="eb-mt-14">
                        <div className="eb-row-between">
                          <span className="eb-trace-meta">pass rate</span>
                          <span className="eb-pass-rate">{result.passRate}%</span>
                        </div>
                        <div className="eb-bar-track">
                          <div
                            className="eb-bar-fill"
                            style={{ "--bar-width": `${result.passRate}%` }}
                          />
                        </div>
                        <div className="eb-row eb-mb-10">
                          <button
                            className="eb-btn-outline eb-btn-sm"
                            onClick={() =>
                              downloadFile(
                                `${ev.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_results.json`,
                                JSON.stringify(result, null, 2),
                                "application/json"
                              )
                            }
                          >
                            Export results (JSON)
                          </button>
                          <button
                            className="eb-btn-outline eb-btn-sm"
                            onClick={() =>
                              downloadFile(
                                `${ev.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_results.csv`,
                                resultsToCSV(ev.name, result),
                                "text/csv"
                              )
                            }
                          >
                            Export results (CSV)
                          </button>
                        </div>
                        {result.results.map((r) => (
                          <div className="eb-result-row" key={r.traceId}>
                            <span>{r.traceTitle}</span>
                            <span className={r.passed ? "eb-pass" : "eb-fail-text"}>
                              {r.passed ? "PASS" : "FAIL"} — {r.detail}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="eb-field-label eb-mt-6">
                      Labels
                    </label>
                    {ev.labels.map((l, i) => (
                      <div className="eb-rubric-row" key={i}>
                        <span className="eb-rubric-score">{l.score}</span>
                        <span>
                          <strong>{l.label}</strong> — {l.definition}
                        </span>
                      </div>
                    ))}
                    <button
                      className="eb-btn-outline eb-btn-sm eb-mt-12"
                      onClick={() => copyRubric(ev)}
                    >
                      {copiedId === ev.id ? "Copied" : "Copy rubric to clipboard"}
                    </button>
                    <p className="eb-trace-meta eb-mt-8">
                      LLM-judge evals need calibration against human review before they run automatically — that workbench is next on the roadmap.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- App ----------
export default function App() {
  const [activeTab, setActiveTab] = useState("projects");
  const [profileOpen, setProfileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return false;

    const storedTheme = window.localStorage.getItem("eval-builder-theme");
    if (storedTheme) return storedTheme === "dark";

    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [projects, setProjects] = useState(() => loadProjects());
  const [currentProjectId, setCurrentProjectId] = useState(() => {
    if (typeof window === "undefined") {
      return loadProjects()[0].id;
    }

    const loadedProjects = loadProjects();
    const savedProjectId = window.localStorage.getItem(CURRENT_PROJECT_KEY);

    return savedProjectId && loadedProjects.some((project) => project.id === savedProjectId)
      ? savedProjectId
      : loadedProjects[0].id;
  });
  const [draft, setDraft] = useState(() => ({
    ...makeEmptyDraft(loadProjects()[0].profile),
    __resetKey: 0,
  }));

  const currentProject =
    projects.find((project) => project.id === currentProjectId) ?? projects[0];

  const profile = currentProject.profile;
  const traces = currentProject.traces;
  const taxonomy = currentProject.taxonomy;
  const evals = currentProject.evals;

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURRENT_PROJECT_KEY, currentProjectId);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    }
  }, [currentProjectId, projects]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("eval-builder-theme", darkMode ? "dark" : "light");
    }
  }, [darkMode]);

  useEffect(() => {
    setDraft({ ...makeEmptyDraft(profile), __resetKey: 0 });
  }, [currentProjectId]);

  const updateCurrentProject = (updater) => {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === currentProjectId
          ? { ...project, ...updater(project), updatedAt: Date.now() }
          : project
      )
    );
  };

  const setProfile = (nextProfile) => {
    updateCurrentProject((project) => ({ profile: nextProfile }));
  };

  const setTraces = (updater) => {
    updateCurrentProject((project) => ({
      traces: typeof updater === "function" ? updater(project.traces) : updater,
    }));
  };

  const setTaxonomy = (updater) => {
    updateCurrentProject((project) => ({
      taxonomy: typeof updater === "function" ? updater(project.taxonomy) : updater,
    }));
  };

  const setEvals = (updater) => {
    updateCurrentProject((project) => ({
      evals: typeof updater === "function" ? updater(project.evals) : updater,
    }));
  };

  const resetDraft = () =>
    setDraft((prev) => ({ ...makeEmptyDraft(profile), __resetKey: prev.__resetKey + 1 }));

  const buildFromTrace = (trace) => {
    setDraft((prev) => ({
      ...makeEmptyDraft(profile),
      name: `Eval: ${trace.title}`,
      sourceTraceId: trace.id,
      goalCriteria: [`Correctly resolves: "${trace.userInput}"`],
      __resetKey: prev.__resetKey + 1,
    }));
    setActiveTab("build");
  };

  const saveEval = (newEval) => {
    setEvals((prev) => [...prev, newEval]);
    resetDraft();
    setActiveTab("library");
  };

  const onCreateProject = (projectName) => {
    const newProject = createProject(projectName.trim() || "Untitled project");
    setProjects((prev) => [...prev, newProject]);
    setCurrentProjectId(newProject.id);
    setActiveTab("projects");
    return newProject;
  };

  const onOpenProject = (projectId) => {
    setCurrentProjectId(projectId);
  };

  const onRenameProject = (projectId, nextName) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === project.name) return;

    setProjects((prev) =>
      prev.map((item) =>
        item.id === projectId ? { ...item, name: trimmed, updatedAt: Date.now() } : item
      )
    );
  };

  const onDeleteProject = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    const confirmed = typeof window !== "undefined"
      ? window.confirm(`Delete "${project.name}"? This project and all of its traces, evals, and settings will be removed.`)
      : true;

    if (!confirmed) return;

    const remainingProjects = projects.filter((item) => item.id !== projectId);

    if (remainingProjects.length === 0) {
      const replacementProject = createProject("My Project");
      setProjects([replacementProject]);
      setCurrentProjectId(replacementProject.id);
      return;
    }

    setProjects(remainingProjects);

    if (projectId === currentProjectId) {
      setCurrentProjectId(remainingProjects[0].id);
    }
  };

  const navItems = [
    { key: "projects", num: 1, label: "Projects" },
    { key: "traces", num: 2, label: "Traces" },
    { key: "build", num: 3, label: "Build eval" },
    { key: "library", num: 4, label: "Library" },
  ];

  return (
    <div className={`eb-app ${darkMode ? "eb-app--dark" : "eb-app--light"}`}>
      <div className="eb-topbar">
        <div className="eb-brand">
          <img className="eb-brand-icon" src={iconPng} alt="Eval Builder Icon" />
          <div className="eb-wordmark eb-serif">
            Eval<span>Builder</span>
          </div>
        </div>
        <div className="eb-row">
          <button className="eb-profile-btn" onClick={() => setDarkMode((value) => !value)}>
            Theme: {darkMode ? "Dark" : "Light"}
          </button>
          <button className="eb-profile-btn" onClick={() => setHelpOpen(true)}>
            Guide
          </button>
          <button className="eb-profile-btn" onClick={() => setProfileOpen((o) => !o)}>
            Product profile {profileOpen ? "▴" : "▾"}
          </button>
        </div>
      </div>

      {profileOpen && <ProfilePanel profile={profile} setProfile={setProfile} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      <div className="eb-layout">
        <div className="eb-rail">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`eb-nav-item ${activeTab === item.key ? "active" : ""}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span className="eb-nav-num">{item.num}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="eb-main">
          {activeTab === "projects" && (
            <ProjectsTab
              projects={projects}
              currentProjectId={currentProjectId}
              onCreateProject={onCreateProject}
              onOpenProject={onOpenProject}
              onRenameProject={onRenameProject}
              onDeleteProject={onDeleteProject}
            />
          )}
          {activeTab === "traces" && (
            <TracesTab
              traces={traces}
              setTraces={setTraces}
              taxonomy={taxonomy}
              setTaxonomy={setTaxonomy}
              onBuildFromTrace={buildFromTrace}
            />
          )}
          {activeTab === "build" && (
            <BuildEvalTab
              draft={draft}
              setDraft={setDraft}
              traces={traces}
              onReset={resetDraft}
              onSave={saveEval}
            />
          )}
          {activeTab === "library" && <LibraryTab evals={evals} traces={traces} />}
        </div>
      </div>
    </div>
  );
}
