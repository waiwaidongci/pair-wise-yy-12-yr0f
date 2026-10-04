import { useState } from "react";
import { StoreProvider, useStore } from "./domain/store";
import { HorsesTab } from "./components/HorsesTab";
import { RecordsTab } from "./components/RecordsTab";
import { VetTab } from "./components/VetTab";
import { ReviewTab } from "./components/ReviewTab";
import { MergeTab } from "./components/MergeTab";
import { HistoryTab } from "./components/HistoryTab";
import "./styles.css";

const TABS = [
  { key: "horses", label: "马匹档案" },
  { key: "records", label: "修蹄记录" },
  { key: "vet", label: "兽医审核" },
  { key: "review", label: "复查计划" },
  { key: "merge", label: "合并中心" },
  { key: "history", label: "蹄铁历史" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function Shell() {
  const [tab, setTab] = useState<TabKey>("horses");
  const { state, setOnline, reset } = useStore();

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62011 · 马术蹄铁修整档案 · 离线协作</p>
        <h1>蹄铁修整离线协作台</h1>
        <span>
          蹄铁师在场边断网登记四蹄蹄形、蹄铁与钉位，兽医在诊室审核蹄病并签字确认疼痛评分；回网后按记录号合并，两边改同一蹄位时保留兽医安全值，另一版待处理。未处置不生成复查通知，档案或复查日期变化后已签意见和通知立即失效重算。
        </span>
        <div className="hero-actions">
          <span className={"online-pill " + (state.online ? "on" : "off")}>
            {state.online ? "● 回网在线" : "○ 断网离线"}
          </span>
          <button onClick={() => setOnline(!state.online)}>
            {state.online ? "切换为断网" : "切换为回网"}
          </button>
          <button onClick={reset}>重置演示数据</button>
        </div>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"tab-btn " + (tab === t.key ? "active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <section className="tab-content">
        {tab === "horses" && <HorsesTab />}
        {tab === "records" && <RecordsTab />}
        {tab === "vet" && <VetTab />}
        {tab === "review" && <ReviewTab />}
        {tab === "merge" && <MergeTab />}
        {tab === "history" && <HistoryTab />}
      </section>
    </main>
  );
}

function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

export default App;
