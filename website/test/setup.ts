import React from "react";

type ReactAct = NonNullable<typeof React.act>;

if (typeof React.act !== "function") {
  React.act = (async (callback: Parameters<ReactAct>[0]) => callback()) as ReactAct;
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
