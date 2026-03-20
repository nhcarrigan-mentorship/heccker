export interface AgentMessage {
  message_id: string;
  session_id: string;
  from_agent: 'orchestrator' | 'research' | 'email' | 'file' | 'chaos';
  to_agent: 'orchestrator' | 'research' | 'email' | 'file' | 'chaos';
  task_type: string;
  payload: any;
  priority: 'high' | 'normal' | 'low';
  timestamp: string;
}

export interface ActivityEvent {
  agent_name: string;
  type: 'update' | 'final' | 'error';
  content: string;
  timestamp: string;
}
