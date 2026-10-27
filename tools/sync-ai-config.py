#!/usr/bin/env python3
"""Generate public Firebase Web config from GitHub Actions repository variables."""
import hashlib
import json
import os
import re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
MODELS={"gemini-3.5-flash-lite","gemini-3.1-flash-lite","gemini-3.8-flash"}
def sync(root=ROOT,env=None):
 env=os.environ if env is None else env
 raw=env.get("PACHISPEC_AI_FIREBASE_CONFIG","").strip()
 key=env.get("PACHISPEC_AI_APP_CHECK_SITE_KEY","").strip()
 verified=env.get("PACHISPEC_AI_SPARK_VERIFIED","").strip().lower()=="true"
 model=env.get("PACHISPEC_AI_MODEL","").strip() or "gemini-3.5-flash-lite"
 if model not in MODELS:raise ValueError("Unsupported PACHISPEC_AI_MODEL.")
 if raw or key or verified:
  if not(raw and key and verified):raise ValueError("Set PACHISPEC_AI_FIREBASE_CONFIG, PACHISPEC_AI_APP_CHECK_SITE_KEY and PACHISPEC_AI_SPARK_VERIFIED=true together.")
  firebase=json.loads(raw)
  if not isinstance(firebase,dict) or any(not isinstance(firebase.get(k),str) or not firebase[k].strip() for k in ("apiKey","projectId","appId")):raise ValueError("Firebase Web config requires apiKey, projectId and appId.")
  if len(key)<10:raise ValueError("Invalid reCAPTCHA Enterprise site key.")
  if any(any(word in k.lower() for word in ("secret","password","private")) for k in firebase):raise ValueError("Do not embed secrets.")
  config={"mode":"shared-firebase","firebase":firebase,"appCheckSiteKey":key,"model":model}
 else:config={"mode":"disabled","firebase":None,"appCheckSiteKey":"","model":model}
 output="/* PUBLIC Firebase AI Logic Web config, not a private Gemini API key. */\n"+"globalThis.PACHISPEC_AI_CONFIG=Object.freeze("+json.dumps(config,ensure_ascii=False,separators=(",",":"))+");\n"
 (root/"ai-config.js").write_text(output,encoding="utf-8")
 fingerprint=hashlib.sha256(output.encode("utf-8")).hexdigest()[:12]
 index_path=root/"index.html"
 index=index_path.read_text(encoding="utf-8")
 pattern=r'(<script src="ai-config\.js\?v=[^"&]+)(?:&(?:amp;)?id=[0-9a-f]{12})?("></script>)'
 updated,count=re.subn(pattern,lambda m:m.group(1)+"&amp;id="+fingerprint+m.group(2),index)
 if count!=1:raise ValueError("Expected one ai-config.js script tag.")
 if updated!=index:index_path.write_text(updated,encoding="utf-8")
 return fingerprint
if __name__=="__main__":
 try:print("Public Firebase config fingerprint: "+sync())
 except (ValueError,OSError,json.JSONDecodeError) as error:raise SystemExit("AI config sync failed: "+str(error))
