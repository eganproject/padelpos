import { app } from "./app.js";
import { startMailer } from "./notifications.js";
const port=Number(process.env.PORT||4000);
const server=app.listen(port,()=>console.log(`Padelix API running at http://localhost:${port}`));
const stopMailer=startMailer();
for(const signal of ["SIGTERM","SIGINT"] as const)process.on(signal,()=>{stopMailer();server.close(()=>process.exit(0))});

