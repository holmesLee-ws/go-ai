#!/usr/bin/env node
// 리포 관리자용 검사기. 학습자에게는 필요 없다.
// 검사: 커리큘럼 형식·정해진 칸만·선수 관계·국내/글로벌 칸·경계 칸(R2·R10·R13), 출처 목록의 URL·조회일·변동·공식 도메인,
// 조문 표기와 바로 뒤 출처 id의 교차 확인(R11), 미리 만든 시각 자료 없음(R5), 설정 JSON 유효성.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const LEVELS = ["Explain", "Apply", "Evaluate", "Develop"];
const FIELDS = ["선수", "핵심 질문", "목표", "만들어 볼 것", "국내 근거", "글로벌 비교", "근거"];
const OPTIONAL = ["경계·연결"];
const GO_AREAS = ["go-develop", "go-security", "go-finance", "go-accounting", "go-hr", "go-scm", "go-control", "go-valuation", "go-project-management"];
// 공식 출처 도메인(R11). 하위 도메인 포함.
const OFFICIAL = ["law.go.kr", "likms.assembly.go.kr", "assembly.go.kr", "msit.go.kr", "pipc.go.kr", "fsc.go.kr", "fss.or.kr",
  "mcst.go.kr", "copyright.or.kr", "korea.kr", "moel.go.kr", "kats.go.kr", "standard.go.kr", "nia.or.kr", "tta.or.kr",
  "eur-lex.europa.eu", "europa.eu", "klri.re.kr", "kssn.net", "nist.gov", "doi.org", "iso.org", "oecd.ai", "oecd.org",
  "leg.colorado.gov", "colorado.gov", "cao.go.jp", "e-gov.go.jp", "cac.gov.cn", "gov.cn", "csed.acm.org"];
const ART = /제\s?(\d+)\s?조(?:\s?의\s?(\d+))?|\b(?:Art\.?|Article)\s?(\d+)/g;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseSources(text) {
  const ids = new Map();
  const problems = [];
  for (const block of text.split(/^### /m).slice(1)) {
    const body = block.split(/\n## /)[0];
    const head = body.split("\n")[0];
    const m = head.match(/^(S\d+) · (.+)$/);
    if (!m) { problems.push(`출처 제목 형식 오류: ${head}`); continue; }
    const id = m[1];
    if (ids.has(id)) problems.push(`출처 ${id}: 중복 id`);
    const f = {};
    for (const line of body.split("\n").slice(1)) {
      const g = line.match(/^- ([^:]+): (.*)$/);
      if (g) f[g[1]] = g[2].trim();
    }
    for (const name of ["URL", "조회일", "확인 방법", "변동"]) if (!f[name]) problems.push(`출처 ${id}: 「${name}」 없음`);
    if (f["조회일"] && !/^\d{4}-\d{2}-\d{2}/.test(f["조회일"])) problems.push(`출처 ${id}: 조회일 형식 오류`);
    if (f["변동"] && !/^(큼|작음)/.test(f["변동"])) problems.push(`출처 ${id}: 변동은 큼·작음 중 하나`);
    if (f["URL"] && !/https?:\/\//.test(f["URL"])) problems.push(`출처 ${id}: URL 없음`);
    for (const u of body.match(/https?:\/\/[^\s)>,`]+/g) || []) {
      let host;
      try { host = new URL(u).hostname; } catch { problems.push(`출처 ${id}: URL 형식 오류`); continue; }
      if (!OFFICIAL.some((d) => host === d || host.endsWith(`.${d}`))) problems.push(`출처 ${id}: 공식 도메인 아님 ${host}`);
    }
    ids.set(id, body);
  }
  return { ids, problems };
}

function parseCurriculum(text, sourceIds) {
  const modules = new Map();
  const problems = [];
  for (const raw of text.split(/^### /m).slice(1)) {
    const block = raw.split(/\n## /)[0];
    const head = block.split("\n")[0];
    const m = head.match(/^([BKGMX]\d+) · (.+)$/);
    if (!m) { problems.push(`모듈 제목 형식 오류: ${head}`); continue; }
    const id = m[1];
    if (modules.has(id)) problems.push(`${id}: 중복 id`);
    const fields = {};
    for (const line of block.split("\n").slice(1)) {
      if (!line.trim()) continue;
      const f = line.match(/^- ([^:]+): (.*)$/);
      if (!f) { problems.push(`${id}: 정해진 칸 밖의 줄 — ${line.slice(0, 30)}`); continue; }
      if (![...FIELDS, ...OPTIONAL].includes(f[1])) { problems.push(`${id}: 정해진 칸이 아님 「${f[1]}」`); continue; }
      if (f[1] in fields) problems.push(`${id}: 「${f[1]}」 칸이 두 번 있음`);
      fields[f[1]] = f[2].trim();
    }
    for (const name of FIELDS) if (!fields[name]) problems.push(`${id}: 「${name}」 없음`);
    for (const name of ["국내 근거", "글로벌 비교"]) if (fields[name] && !/\[S\d+\]/.test(fields[name]) && !fields[name].startsWith("해당 없음")) problems.push(`${id}: 「${name}」에 출처 id나 「해당 없음」 없음`);
    if (fields["목표"] && !LEVELS.some((l) => fields["목표"].startsWith(`${l} — `))) problems.push(`${id}: 목표 수준 형식 오류`);
    const b = fields["경계·연결"];
    if (b !== undefined) {
      if (!GO_AREAS.some((a) => new RegExp(`(?<![\\w-])${esc(a)}(?![\\w-])`).test(b))) problems.push(`${id}: 경계·연결이 go-* 영역을 가리키지 않음`);
      if (/(?<![\w-])[A-Z]\d+(?![\w-])/.test(b)) problems.push(`${id}: 경계·연결에 다른 리포 모듈 id를 쓰지 않음`);
    }
    for (const ref of block.match(/\[S\d+\]/g) || []) if (!sourceIds.has(ref.slice(1, -1))) problems.push(`${id}: 없는 출처 ${ref}`);
    const prereq = !fields["선수"] || fields["선수"] === "없음" ? [] : fields["선수"].split(",").map((s) => s.trim());
    modules.set(id, prereq);
  }
  for (const [id, prereq] of modules) for (const p of prereq) if (!modules.has(p)) problems.push(`${id}: 없는 선수 ${p}`);
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 2 || !modules.has(id)) return;
    if (state.get(id) === 1) { problems.push(`선수 순환: ${[...path, id].join(" → ")}`); return; }
    state.set(id, 1);
    for (const p of modules.get(id)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of modules.keys()) visit(id, []);
  return { modules, problems };
}

// 호·목 단위는 대조하지 않는다(조 단위까지만). 조문 표기는 같은 줄에서 바로 뒤에 오는 [Sx] 출처 블록에 같은 조문(경계 일치)이 있어야 한다(R11 ③).
function crossCheckArticles(name, text, sources) {
  const problems = [];
  for (const line of text.split("\n")) {
    for (const a of line.matchAll(ART)) {
      const rest = line.slice(a.index);
      const ref = rest.match(/\[(S\d+)\]/);
      if (!ref) { problems.push(`${name}: 출처 id 없이 조문 표기 「${a[0]}」 — ${line.slice(0, 40)}`); continue; }
      const src = sources.get(ref[1]);
      if (!src) continue; // 없는 출처는 다른 검사가 잡는다
      const pat = a[3]
        ? new RegExp(`\\b(?:Art\\.?|Article)\\s?${a[3]}(?!\\d)`)
        : new RegExp(`제\\s?${a[1]}\\s?조${a[2] ? `\\s?의\\s?${a[2]}` : ""}(?!\\s?의|\\d)`);
      if (!pat.test(src)) problems.push(`${name}: 「${a[0]}」가 ${ref[1]}에 없음`);
    }
  }
  return problems;
}

function findVisualAssets(files) {
  const allowedJs = /^tools\/.*\.m?js$/;
  return files.filter((f) => /\.(html?|css|svg|png|jpe?g|gif|webp|avif|pdf|jsx|tsx)$/i.test(f) || (/\.m?js$/i.test(f) && !allowedJs.test(f)));
}

// 학습자 경로의 Markdown에는 코드 블록이든 본문이든 복사용 마크업을 두지 않는다. docs/build는 구축 기록이라 제외.
function findTemplateMarkup(name, text) {
  return /<(!doctype|html|svg|style|canvas|script)\b/i.test(text) ? [name] : [];
}

function main() {
  const { ids: sources, problems: sp } = parseSources(read("curriculum/sources.md"));
  errors.push(...sp);
  if (sources.size === 0) errors.push("출처를 찾지 못함");
  const mapText = read("curriculum/map.md");
  const { modules, problems } = parseCurriculum(mapText, sources);
  errors.push(...problems);
  if (modules.size === 0) errors.push("모듈을 찾지 못함");

  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const md = files.filter((x) => x.endsWith(".md") && existsSync(join(root, x)));
  const learnerPath = md.filter((x) => !x.startsWith("docs/build/"));
  for (const f of learnerPath.filter((x) => x !== "curriculum/sources.md")) errors.push(...crossCheckArticles(f, read(f), sources));
  for (const f of findVisualAssets(files)) errors.push(`미리 만든 시각 자료 금지: ${f}`);
  for (const f of learnerPath) for (const n of findTemplateMarkup(f, read(f))) errors.push(`복사용 마크업 금지: ${n}`);

  for (const p of [".claude/settings.json", "learner-template/state.json"]) {
    try { JSON.parse(read(p)); } catch (e) { errors.push(`${p}: JSON 오류 ${e.constructor.name}`); }
  }
  if (!existsSync(join(root, "learner-template/log.md"))) errors.push("learner-template/log.md 없음");
  for (const s of readdirSync(join(root, ".claude/skills"))) {
    if (statSync(join(root, ".claude/skills", s)).isDirectory() && !existsSync(join(root, ".claude/skills", s, "SKILL.md"))) errors.push(`스킬 ${s}: SKILL.md 없음`);
  }
  if (!read(".gitignore").split("\n").includes("learner/")) errors.push(".gitignore에 learner/ 없음");

  if (errors.length) { console.error(errors.map((e) => `FAIL ${e}`).join("\n")); process.exit(1); }
  console.log(`OK 모듈 ${modules.size}개, 출처 ${sources.size}개, 파일 ${files.length}개 검사`);
}

main();
