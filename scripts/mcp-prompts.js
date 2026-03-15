const PROMPTS = [
  {
    name: 'summarize_today',
    description: 'Summarize everything worked on today across projects.',
    arguments: [
      {
        name: 'project',
        description: 'Optional project name to scope the summary',
        required: false
      }
    ]
  },
  {
    name: 'project_onboarding',
    description: 'Provide full context for starting work on a project.',
    arguments: [
      {
        name: 'project',
        description: 'Project name to onboard',
        required: true
      }
    ]
  },
  {
    name: 'weekly_report',
    description: 'Generate a weekly report for a project.',
    arguments: [
      {
        name: 'project',
        description: 'Project name to report on',
        required: true
      },
      {
        name: 'week_ending',
        description: 'Optional week ending date (YYYY-MM-DD)',
        required: false
      }
    ]
  },
  {
    name: 'decision_log',
    description: 'List architectural decisions for a project.',
    arguments: [
      {
        name: 'project',
        description: 'Project name to scan',
        required: true
      },
      {
        name: 'month',
        description: 'Optional month to filter (YYYY-MM)',
        required: false
      }
    ]
  }
];

function listPrompts() {
  return PROMPTS.map(prompt => ({
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments
  }));
}

function renderPrompt(name, args = {}) {
  const prompt = PROMPTS.find(p => p.name === name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const project = typeof args.project === 'string' ? args.project : '';
  const weekEnding = typeof args.week_ending === 'string' ? args.week_ending : '';
  const month = typeof args.month === 'string' ? args.month : '';

  let text = '';

  switch (name) {
    case 'summarize_today':
      text = `Summarize everything I worked on today${project ? ` for project \"${project}\"` : ''}. Use Memex tools (recent_sessions, search_sessions, get_session) and produce:\n- Summary\n- Key decisions\n- Open questions\n- Next steps`;
      break;
    case 'project_onboarding':
      text = `Give me full context for starting work on project \"${project}\". Use get_bundle, recent_sessions, search_sessions, and get_session. Include:\n- Project summary\n- Tech stack\n- Recent sessions and outcomes\n- Key conventions and decisions\n- Risks or open issues`;
      break;
    case 'weekly_report':
      text = `Generate a weekly report for project \"${project}\"${weekEnding ? ` (week ending ${weekEnding})` : ''}. Use recent_sessions and search_sessions, then fetch details with get_session. Output:\n- Highlights\n- Decisions\n- Risks\n- Next week priorities`;
      break;
    case 'decision_log':
      text = `List architectural decisions for project \"${project}\"${month ? ` in ${month}` : ''}. Use search_sessions with decision-related keywords and fetch details with get_session. Output as a bullet list with session id and rationale.`;
      break;
    default:
      text = `Prompt \"${name}\" requested.`;
  }

  return {
    description: prompt.description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text }
      }
    ]
  };
}

module.exports = {
  listPrompts,
  renderPrompt
};

