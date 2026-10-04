import "./styles.css";

const project = {
  "sourceNo": 6,
  "id": "hxyfront-62011",
  "port": 62011,
  "title": "马术蹄铁修整档案",
  "domain": "马术蹄铁",
  "prompt": "做一个面向马术俱乐部蹄铁师的修蹄记录前端项目，可以记录马匹编号、步态问题、蹄形评估、蹄铁类型、钉位、修蹄日期、下次复查日期和照片备注。页面需要有马匹列表、复查提醒、左右前后蹄对比记录、异常步态标记和蹄铁更换历史。",
  "palette": [
    "#78350f",
    "#166534",
    "#2563eb"
  ],
  "metrics": [
    "待复查",
    "异常步态",
    "更换蹄铁",
    "马匹档案"
  ],
  "filters": [
    "前蹄",
    "后蹄",
    "运动马",
    "休养马"
  ],
  "fields": [
    "马匹编号",
    "步态问题",
    "蹄形评估",
    "蹄铁类型",
    "钉位",
    "下次复查"
  ],
  "records": [
    [
      "HORSE-18",
      "右前蹄外侧磨耗",
      "铝蹄铁",
      "14天后复查"
    ],
    [
      "HORSE-27",
      "后蹄裂纹",
      "加护蹄垫",
      "拍照归档"
    ],
    [
      "HORSE-31",
      "步态轻微不稳",
      "需教练复核",
      "已标记"
    ]
  ]
};

function App() {
  return (
    <main className="app">
      <section className="hero">
        <p>{project.id} · 源提示词{project.sourceNo} · Port {project.port}</p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      <section className="metrics">
        {project.metrics.map((metric: string, index: number) => (
          <article key={metric}>
            <small>{metric}</small>
            <strong>{[28, 6, 14, 91][index] ?? 10}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}分类</h2>
          <div className="chips">
            {project.filters.map((item: string) => (
              <button key={item}>{item}</button>
            ))}
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增记录</h2>
            </div>
            <button className="primary">保存记录</button>
          </div>
          <div className="field-grid">
            {project.fields.map((field: string) => (
              <label key={field}>
                <span>{field}</span>
                <input placeholder={"填写" + field} />
              </label>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>近期记录</p>
            <h2>工作台摘要</h2>
          </div>
          <button>导出CSV</button>
        </div>
        <div className="records">
          {project.records.map((record: string[], index: number) => (
            <article key={record.join("-")}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div>
                <h3>{record[0]}</h3>
                <p>{record.slice(1).join(" · ")}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
