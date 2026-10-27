import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
// Auth fragments are consumed and cleared by App before any navigation layer.
createApp(App).mount("#app");
