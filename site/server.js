import { createApp } from "./app-factory.js";

const PORT = process.env.PORT || 3000;

createApp().listen(PORT, () => {
  console.log(`Caption Mode running at http://localhost:${PORT}`);
});
