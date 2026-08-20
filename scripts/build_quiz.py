#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每日測驗產生器（理財小幫手中英文版）
- 讀中文版 live news.json（title_en/summary_en）→ Groq gpt-oss-120b 出題
  （每則新聞 2 題：字彙 1＋理解 1，英文選擇題）
- 雙模型把關：gpt-oss-20b 獨立作答，答案不一致的題目剔除
- 輸出 data/quiz.json；quiz 日期已等於 news 日期時直接跳過（冪等）
- 零 Claude 用量；GROQ_API_KEY 取自環境變數，本機退回 ~/.groq_key
- Groq 走 urllib 必帶瀏覽器 UA，否則 Cloudflare 403
"""

import json
import os
import random
import sys
import time
import urllib.request

NEWS_URL = "https://iriswen518-alt.github.io/morning-board/data/news.json"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEN_MODEL = "openai/gpt-oss-120b"
VERIFY_MODEL = "openai/gpt-oss-20b"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "data", "quiz.json")
MAX_ITEMS = 6  # 最多取 6 則新聞（12 題）
SLEEP_SEC = 8  # Groq 免費層 TPM 8000，逐筆間隔


def api_key():
    k = os.environ.get("GROQ_API_KEY", "").strip()
    if not k:
        p = os.path.expanduser("~/.groq_key")
        if os.path.exists(p):
            k = open(p).read().strip()
    if not k:
        sys.exit("GROQ_API_KEY not set and ~/.groq_key not found")
    return k


def http_json(url, payload=None, headers=None, retries=3):
    for attempt in range(retries):
        try:
            data = json.dumps(payload).encode() if payload is not None else None
            req = urllib.request.Request(
                url, data=data, headers=headers or {"User-Agent": UA}
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1}: {e}", flush=True)
            time.sleep(20)


def groq_chat(key, model, messages, reasoning_effort=None):
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
    }
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    headers = {
        "User-Agent": UA,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    resp = http_json(GROQ_URL, payload, headers)
    return json.loads(resp["choices"][0]["message"]["content"])


GEN_PROMPT = """You are an English tutor creating a daily quiz for a Taiwanese finance professional \
learning English through market news. From the news summary below, write EXACTLY 2 multiple-choice questions:

1. type "vocab": pick ONE useful English word or phrase that appears in the summary \
(finance or general academic vocabulary, not a proper noun). Ask what it means as used in the text.
2. type "comprehension": ask about a fact clearly stated in the summary.

Rules:
- Question and all 4 options in simple English. Exactly ONE option is correct.
- Wrong options must be plausible but clearly wrong per the text.
- "explain_en": 1-2 simple English sentences explaining the answer.
- "explain_zh": 繁體中文解說（1-2 句，白話）。

Return JSON: {"questions":[{"type":"vocab","question":"...","options":["...","...","...","..."],\
"answer":0,"explain_en":"...","explain_zh":"..."},{"type":"comprehension",...}]}

News title: {title}
News summary: {summary}"""

VERIFY_PROMPT = """Read the news summary and answer the multiple-choice question. \
Reply JSON only: {"answer": <0-3>}.

Summary: {summary}
Question: {question}
Options:
{options}"""


def pick_items(news):
    """跨 section 輪流取，最多 MAX_ITEMS 則有英文摘要的新聞"""
    buckets = []
    for sec in news.get("sections", []):
        items = [
            it
            for it in sec.get("items", [])
            if it.get("title_en") and len(it.get("summary_en", "")) > 150
        ]
        if items:
            buckets.append(items)
    picked, i = [], 0
    while len(picked) < MAX_ITEMS and any(len(b) > i for b in buckets):
        for b in buckets:
            if len(b) > i and len(picked) < MAX_ITEMS:
                picked.append(b[i])
        i += 1
    return picked


def main():
    key = api_key()
    news = http_json(NEWS_URL + "?t=%d" % time.time())
    date = news.get("news_date", "")
    if not date:
        sys.exit("news.json has no news_date")

    if os.path.exists(OUT_PATH):
        try:
            if json.load(open(OUT_PATH)).get("date") == date:
                print(f"quiz.json already at {date}, skip")
                return
        except Exception:
            pass

    items = pick_items(news)
    if not items:
        sys.exit("no news items with English summaries")
    print(f"news {date}: generating from {len(items)} items", flush=True)

    questions = []
    for n, it in enumerate(items):
        title, summary = it["title_en"], it["summary_en"]
        print(f"[gen {n + 1}/{len(items)}] {title[:60]}", flush=True)
        try:
            out = groq_chat(
                key,
                GEN_MODEL,
                [
                    {
                        "role": "user",
                        "content": GEN_PROMPT.replace("{title}", title).replace(
                            "{summary}", summary
                        ),
                    }
                ],
                reasoning_effort="low",
            )
        except Exception as e:
            print(f"  gen failed: {e}", flush=True)
            continue
        for q in out.get("questions", []):
            opts, ans = q.get("options"), q.get("answer")
            if (
                not isinstance(opts, list)
                or len(opts) != 4
                or not isinstance(ans, int)
                or not 0 <= ans <= 3
                or not q.get("question")
            ):
                continue
            # 洗牌選項位置（以題目內容定種子，避免正解集中同一位置）
            correct = opts[ans]
            rnd = random.Random(q["question"])
            rnd.shuffle(opts)
            q["answer"] = opts.index(correct)
            q["news_title_en"] = title
            q["_summary"] = summary
            questions.append(q)
        time.sleep(SLEEP_SEC)

    # 雙模型把關：第二模型獨立作答，不一致者剔除
    verified = []
    for n, q in enumerate(questions):
        print(f"[verify {n + 1}/{len(questions)}] {q['question'][:60]}", flush=True)
        try:
            opts_txt = "\n".join(f"{i}. {o}" for i, o in enumerate(q["options"]))
            v = groq_chat(
                key,
                VERIFY_MODEL,
                [
                    {
                        "role": "user",
                        "content": VERIFY_PROMPT.replace("{summary}", q["_summary"])
                        .replace("{question}", q["question"])
                        .replace("{options}", opts_txt),
                    }
                ],
            )
            if int(v.get("answer", -1)) == q["answer"]:
                verified.append(q)
            else:
                print(
                    f"  dropped (verifier chose {v.get('answer')} vs {q['answer']})",
                    flush=True,
                )
        except Exception as e:
            print(f"  verify failed, dropped: {e}", flush=True)
        time.sleep(SLEEP_SEC)

    if len(verified) < 4:
        sys.exit(
            f"only {len(verified)} questions survived verification, refusing to publish"
        )

    for i, q in enumerate(verified):
        q["id"] = f"{date}-{i:02d}"
        q.pop("_summary", None)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    out = {"date": date, "questions": verified}
    json.dump(out, open(OUT_PATH, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {OUT_PATH}: {len(verified)} questions for {date}")


if __name__ == "__main__":
    main()
