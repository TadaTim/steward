import { createSteward, seedDemo } from "./system.js";
import { createConsoleServer } from "./server.js";

const sys = createSteward(":memory:");
seedDemo(sys);
const port = Number(process.env.PORT ?? 4173);
createConsoleServer(sys).listen(port, () => {
  console.log(`Steward demo (seeded) on http://localhost:${port}`);
  console.log("Try: / (home), /approvals (1 pending), /missions, /vault, /ledger, /brief");
});
