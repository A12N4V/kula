import { health } from "./health";

const app = { get: (_p: string, h: () => void) => h() };

app.get("/health", health);
