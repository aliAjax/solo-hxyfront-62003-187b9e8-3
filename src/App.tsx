import "./styles.css";

const project = {
  "sourceNo": 5,
  "id": "hxyfront-62003",
  "port": 62003,
  "title": "法医昆虫学样本记录",
  "domain": "法医昆虫学",
  "prompt": "做一个法医昆虫学样本记录前端工具，用来记录采样地点、环境温度、尸体暴露阶段、昆虫种类、发育阶段、采样时间、保存方式和鉴定备注。页面需要有样本批次列表、发育阶段筛选、温度记录图、案件样本关联页和单个样本详情卡片。",
  "palette": [
    "#365314",
    "#a16207",
    "#dc2626"
  ],
  "metrics": [
    "样本批次",
    "平均温度",
    "发育阶段",
    "待鉴定"
  ],
  "filters": [
    "卵",
    "幼虫",
    "蛹",
    "成虫"
  ],
  "fields": [
    "采样地点",
    "环境温度",
    "暴露阶段",
    "昆虫种类",
    "发育阶段",
    "保存方式"
  ],
  "records": [
    [
      "CASE-042-A",
      "室外草地",
      "幼虫三龄，28.6℃",
      "乙醇保存"
    ],
    [
      "CASE-042-B",
      "阴影区域",
      "蛹期样本",
      "需复核种属"
    ],
    [
      "CASE-051-A",
      "水沟边缘",
      "成虫采集",
      "已完成拍照"
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
            <strong>{[86, 14, 7, 32][index] ?? 12}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}筛选</h2>
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
            <button className="primary">保存草稿</button>
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
            <p>历史记录</p>
            <h2>近期工作台</h2>
          </div>
          <button>导出摘要</button>
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
