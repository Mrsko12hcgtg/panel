const te = new TextEncoder();
const td = new TextDecoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type": "application/json; charset=utf-8"}
  });
}

function uuidv4() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function token(n = 32) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map(x => x.toString(16).padStart(2,"0")).join("");
}

function parseUUID(s) {
  const clean = s.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(clean)) return null;
  const out = new Uint8Array(16);
  for (let i=0; i<16; i++) out[i] = parseInt(clean.slice(i*2,i*2+2),16);
  return out;
}

function equalBytes(a,b) {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i=0;i<a.length;i++) x |= a[i]^b[i];
  return x === 0;
}

function readAddr(buf, p) {
  const type = buf[p++];
  if (type === 1) {
    if (buf.length < p+4) throw new Error("bad ipv4");
    const host = [...buf.slice(p,p+4)].join(".");
    return {host, p:p+4};
  }
  if (type === 2) {
    const len = buf[p++];
    if (buf.length < p+len) throw new Error("bad domain");
    return {host: td.decode(buf.slice(p,p+len)), p:p+len};
  }
  if (type === 3) {
    if (buf.length < p+16) throw new Error("bad ipv6");
    const parts = [];
    for (let i=0;i<16;i+=2) parts.push(((buf[p+i]<<8)|buf[p+i+1]).toString(16));
    return {host: parts.join(":"), p:p+16};
  }
  throw new Error("unsupported address type");
}

async function handleVless(request, env) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return new Response("WebSocket required", {status:426});

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  let socket = null;
  let socketWriter = null;
  let established = false;

  const closeAll = () => {
    try { server.close(); } catch {}
    try { socket?.close(); } catch {}
  };

  server.addEventListener("message", async (event) => {
    try {
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data instanceof Uint8Array
          ? event.data
          : te.encode(String(event.data));

      if (!established) {
        if (data.length < 24) throw new Error("short vless header");

        const version = data[0];
        if (version !== 0) throw new Error("unsupported vless version");

        const id = data.slice(1,17);
        const row = await env.DB.prepare(
          "SELECT uuid FROM users WHERE enabled=1"
        ).all();

        let ok = false;
        for (const r of (row.results || [])) {
          const u = parseUUID(r.uuid);
          if (u && equalBytes(u,id)) { ok = true; break; }
        }
        if (!ok) throw new Error("invalid user");

        const addonsLen = data[17];
        let p = 18 + addonsLen;
        if (data.length < p+4) throw new Error("bad request");

        const command = data[p++];
        if (command !== 1) throw new Error("TCP only");

        const port = (data[p++] << 8) | data[p++];
        const addr = readAddr(data,p);
        p = addr.p;

        socket = connect(`${addr.host}:${port}`);
        socketWriter = socket.writable.getWriter();
        established = true;

        const reader = socket.readable.getReader();
        (async () => {
          try {
            while (true) {
              const {value, done} = await reader.read();
              if (done) break;
              if (server.readyState === WebSocket.OPEN) server.send(value);
            }
          } finally {
            try { reader.releaseLock(); } catch {}
            closeAll();
          }
        })();

        if (data.length > p) await socketWriter.write(data.slice(p));
      } else {
        if (socketWriter) await socketWriter.write(data);
      }
    } catch {
      closeAll();
    }
  });

  server.addEventListener("close", closeAll);
  server.addEventListener("error", closeAll);

  return new Response(null, {status:101, webSocket:client});
}

function adminPage() {
  return new Response(`<!doctype html>
<html lang="fa" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mini-ZEUS</title>
<style>
body{margin:0;background:#080b10;color:#eee;font-family:system-ui;padding:18px}
main{max-width:760px;margin:auto}.card{background:#111722;border:1px solid #263044;border-radius:18px;padding:18px;margin:12px 0}
input,button{width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid #344056;background:#0c111a;color:#fff;margin:6px 0}
button{background:#2563eb;border:0;font-weight:700}.u{padding:12px 0;border-bottom:1px solid #293244;word-break:break-all}
small{color:#9ca8ba}.danger{background:#b91c1c}
</style>
<main>
<h1>⚡ Mini-ZEUS</h1>
<div class="card">
<input id="token" type="password" placeholder="ADMIN_TOKEN">
<button onclick="load()">ورود</button>
</div>
<div class="card" id="box" hidden>
<input id="name" placeholder="نام کاربر">
<button onclick="add()">ساخت کاربر</button>
<div id="list"></div>
</div>
<script>
let T="";
async function api(path,opt={}){opt.headers={...(opt.headers||{}),Authorization:"Bearer "+T};let r=await fetch(path,opt);if(!r.ok)throw Error(await r.text());return r.json()}
async function load(){T=document.getElementById("token").value;try{await refresh();box.hidden=false}catch(e){alert("توکن اشتباه است")}}
async function refresh(){let x=await api("/api/users");list.innerHTML=x.users.map(u=>'<div class="u"><b>'+esc(u.name)+'</b><br><small>UUID: '+u.uuid+'<br>VLESS: '+esc(u.vless)+'</small><br><button class="danger" onclick="del('+u.id+')">حذف</button></div>').join("")}
async function add(){let name=document.getElementById("name").value||"User";await api("/api/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});name.value="";await refresh()}
async function del(id){if(confirm("حذف شود؟")){await api("/api/users/"+id,{method:"DELETE"});await refresh()}}
function esc(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
</script></main></html>`, {headers:{"content-type":"text/html; charset=utf-8"}});
}

function authorized(request, env) {
  const h = request.headers.get("Authorization") || "";
  return env.ADMIN_TOKEN && h === `Bearer ${env.ADMIN_TOKEN}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") return handleVless(request, env);

    if (url.pathname === "/admin" && request.method === "GET")
      return adminPage();

    if (url.pathname === "/api/users") {
      if (!authorized(request,env)) return json({error:"unauthorized"},401);

      if (request.method === "GET") {
        const r = await env.DB.prepare(
          "SELECT id,name,uuid,sub_token,enabled,created_at FROM users ORDER BY id DESC"
        ).all();
        const users = (r.results||[]).map(u => ({
          ...u,
          vless:`vless://${u.uuid}@${url.host}:443?encryption=none&security=tls&type=ws&path=%2Fws#${encodeURIComponent(u.name)}`,
          subscription:`${url.origin}/sub/${u.sub_token}`
        }));
        return json({users});
      }

      if (request.method === "POST") {
        const body = await request.json().catch(()=>({}));
        const name = String(body.name || "User").slice(0,80);
        const uuid = uuidv4();
        const sub = token(24);
        await env.DB.prepare(
          "INSERT INTO users(name,uuid,sub_token) VALUES(?,?,?)"
        ).bind(name,uuid,sub).run();
        return json({ok:true,name,uuid,sub_token:sub});
      }
    }

    if (url.pathname.startsWith("/api/users/") && request.method === "DELETE") {
      if (!authorized(request,env)) return json({error:"unauthorized"},401);
      const id = Number(url.pathname.split("/").pop());
      await env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run();
      return json({ok:true});
    }

    if (url.pathname.startsWith("/sub/") && request.method === "GET") {
      const sub = url.pathname.slice(5);
      const r = await env.DB.prepare(
        "SELECT name,uuid FROM users WHERE sub_token=? AND enabled=1"
      ).bind(sub).first();
      if (!r) return new Response("Not found",{status:404});

      const vless = `vless://${r.uuid}@${url.host}:443?encryption=none&security=tls&type=ws&path=%2Fws#${encodeURIComponent(r.name)}`;
      return new Response(btoa(vless)+"\n", {
        headers: {
          "content-type":"text/plain; charset=utf-8",
          "cache-control":"no-store"
        }
      });
    }

    if (url.pathname === "/") return new Response("Mini-ZEUS is running.");
    return new Response("Not found",{status:404});
  }
};
