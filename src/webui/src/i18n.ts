export interface WebMessages {
  experimental: string;
  sessions: string;
  newSession: string;
  noSessions: string;
  control: string;
  owner: string;
  readOnly: string;
  takeover: string;
  connected: string;
  connecting: string;
  reconnecting: string;
  send: string;
  cancel: string;
  prompt: string;
  returnLatest: string;
  input: string;
  output: string;
  allowOnce: string;
  allowSession: string;
  deny: string;
  confirm: string;
  reject: string;
  tool: string;
  duration: string;
  thinking: string;
  openSessions: string;
  closeSessions: string;
  noTls: string;
  phases: Record<string, string>;
}

const catalogs: Record<"zh" | "en", WebMessages> = {
  zh: {
    experimental: "实验性 Web",
    sessions: "会话",
    newSession: "新建会话",
    noSessions: "当前工作区暂无会话",
    control: "控制权",
    owner: "可控制",
    readOnly: "只读",
    takeover: "接管控制权",
    connected: "已连接",
    connecting: "连接中",
    reconnecting: "正在重连",
    send: "发送",
    cancel: "停止",
    prompt: "描述要完成的任务",
    returnLatest: "回到最新",
    input: "输入",
    output: "输出",
    allowOnce: "仅本次允许",
    allowSession: "本会话允许",
    deny: "拒绝",
    confirm: "确认",
    reject: "取消",
    tool: "工具",
    duration: "耗时",
    thinking: "思考",
    openSessions: "打开会话",
    closeSessions: "关闭会话",
    noTls: "远程模式不提供 TLS 或沙箱",
    phases: {
      starting: "启动中",
      idle: "空闲",
      thinking: "思考中",
      rendering: "生成中",
      tool: "执行工具",
      reviewing: "等待审批",
      failed: "失败",
    },
  },
  en: {
    experimental: "Experimental Web",
    sessions: "Sessions",
    newSession: "New session",
    noSessions: "No sessions in this workspace",
    control: "Control",
    owner: "Writable",
    readOnly: "Read only",
    takeover: "Take control",
    connected: "Connected",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    send: "Send",
    cancel: "Stop",
    prompt: "Describe the task to complete",
    returnLatest: "Return to latest",
    input: "Input",
    output: "Output",
    allowOnce: "Allow once",
    allowSession: "Allow for session",
    deny: "Deny",
    confirm: "Confirm",
    reject: "Reject",
    tool: "Tool",
    duration: "Duration",
    thinking: "Thinking",
    openSessions: "Open sessions",
    closeSessions: "Close sessions",
    noTls: "Remote mode provides no TLS or sandbox",
    phases: {
      starting: "starting",
      idle: "idle",
      thinking: "thinking",
      rendering: "rendering",
      tool: "running tool",
      reviewing: "awaiting approval",
      failed: "failed",
    },
  },
};

export function messagesFor(language: "zh" | "en"): WebMessages {
  return catalogs[language];
}
