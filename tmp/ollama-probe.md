2025-09-17T08:18:35.859Z **[INFO]** Response Body {"model":"llama3.1:latest","created_at":"2025-09-17T08:18:35.845018Z","message":{"role":"assistant","content":"{\"ok\": true, \"modelEcho\": \"I am an artificial intelligence model that can assist with a variety of tasks.\"}"},"done_reason":"stop","done":true,"total_duration":12083265166,"load_duration":4473966166,"prompt_eval_count":54,"prompt_eval_duration":4969577208,"eval_count":27,"eval_duration":2636643459}
2025-09-17T08:18:35.863Z **[INFO]** Raw content {"ok": true, "modelEcho": "I am an artificial intelligence model that can assist with a variety of tasks."}
2025-09-17T08:18:35.864Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T08:19:11.433Z **[INFO]** Response Body {"model":"llama3.1:latest","created_at":"2025-09-17T08:19:11.421713Z","message":{"role":"assistant","content":"{\"ok\": true, \"modelEcho\": \"JSON API\"}"},"done_reason":"stop","done":true,"total_duration":3883513917,"load_duration":94691959,"prompt_eval_count":54,"prompt_eval_duration":2327349000,"eval_count":14,"eval_duration":1458586500}
2025-09-17T08:19:11.440Z **[INFO]** Raw content {"ok": true, "modelEcho": "JSON API"}
2025-09-17T08:19:11.441Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T08:22:16.667Z **[ERROR]** Probe HTTP failed (await uFetch(req.endpoint, { ...req, shouldParse: !0 })).text is not a function. (In '(await uFetch(req.endpoint, { ...req, shouldParse: !0 })).text()', '(await uFetch(req.endpoint, { ...req, shouldParse: !0 })).text' is undefined)
2025-09-17T08:22:37.380Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "ResNet-50"
}
2025-09-17T08:27:30.119Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T08:28:29.373Z **[INFO]** Raw content {"ok":true,"modelEcho":"JSON API Strictly Enforcing Schema Compliance"}
2025-09-17T08:42:26.482Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "JSON API"
}
2025-09-17T08:42:27.753Z **[WARN]** customCheck: invalid shape 
2025-09-17T08:42:29.116Z **[WARN]** customCheck: invalid shape 
2025-09-17T08:42:30.578Z **[WARN]** customCheck: invalid shape 
2025-09-17T08:42:30.581Z **[ERROR]** Service parse failed Response failed custom check
2025-09-17T08:45:49.735Z **[INFO]** Raw content {"ok": true, "modelEcho": "Hello, World!"}
2025-09-17T08:45:51.139Z **[WARN]** customCheck: invalid shape 
2025-09-17T08:45:52.853Z **[WARN]** customCheck: invalid shape 
2025-09-17T08:45:54.811Z **[WARN]** customCheck: invalid shape 
2025-09-17T08:45:54.813Z **[ERROR]** Service parse failed Response failed custom check
2025-09-17T08:49:48.372Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "Neural Network Model"
}
2025-09-17T08:49:49.888Z **[WARN]** customCheck: invalid shape
2025-09-17T08:49:50.963Z **[WARN]** customCheck: invalid shape
2025-09-17T08:49:50.968Z **[ERROR]** Service parse failed Response failed custom check
2025-09-17T08:51:05.488Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "The Thinker"
}
2025-09-17T08:51:07.014Z **[WARN]** customCheck: invalid shape
2025-09-17T08:51:09.210Z **[WARN]** customCheck: invalid shape
2025-09-17T08:51:09.211Z **[ERROR]** Service parse failed Response failed custom check
2025-09-17T08:51:24.165Z **[INFO]** Raw content {"ok": true, "modelEcho": "My AI Model is ready to assist you."}
2025-09-17T08:51:25.516Z **[WARN]** customCheck: invalid shape
2025-09-17T08:51:26.697Z **[WARN]** customCheck: invalid shape
2025-09-17T08:51:26.700Z **[ERROR]** Service parse failed Response failed custom check
2025-09-17T08:52:32.625Z **[INFO]** Raw content {"ok":true,"modelEcho":"<ModelName>"}
2025-09-17T08:52:34.270Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:00:06.836Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "JSON API"
}
2025-09-17T09:00:12.078Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:14:49.496Z **[INFO]** Raw content {"ok": true, "modelEcho": "ResNet-50"}
2025-09-17T09:14:51.028Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:15:46.300Z **[INFO]** Ollama payload {
  "model": "llama3.1:latest",
  "messages": [
    {
      "role": "system",
      "content": "You are a strict JSON API. Return only valid JSON per the schema."
    },
    {
      "role": "user",
      "content": "Return {\"ok\":true, \"modelEcho\": \"<model>\" } with <model> populated from your configured model."
    }
  ],
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "ok": {
        "type": "boolean"
      },
      "modelEcho": {
        "type": "string"
      }
    },
    "required": [
      "ok",
      "modelEcho"
    ],
    "additionalProperties": false
  }
}
2025-09-17T09:15:49.515Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "JSON API"
}
2025-09-17T09:15:49.518Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:15:49.519Z **[INFO]** Ollama payload {
  "model": "llama3.1:latest",
  "messages": [
    {
      "role": "system",
      "content": "You are a strict JSON API. Return only valid JSON per the schema."
    },
    {
      "role": "user",
      "content": "Return {\"ok\":true, \"modelEcho\": \"<model>\" } with <model> populated from your configured model."
    }
  ],
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "ok": {
        "type": "boolean"
      },
      "modelEcho": {
        "type": "string"
      }
    },
    "required": [
      "ok",
      "modelEcho"
    ],
    "additionalProperties": false
  },
  "temperature": 0
}
2025-09-17T09:15:50.973Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:15:50.974Z **[ERROR]** {}
2025-09-17T09:15:50.975Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:15:50.975Z **[ERROR]** {}
2025-09-17T09:15:50.975Z **[INFO]** Ollama: parsed OK
2025-09-17T09:15:50.975Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:16:25.080Z **[INFO]** Ollama payload {
  "model": "llama3.1:latest",
  "messages": [
    {
      "role": "system",
      "content": "You are a strict JSON API. Return only valid JSON per the schema."
    },
    {
      "role": "user",
      "content": "Return {\"ok\":true, \"modelEcho\": \"<model>\" } with <model> populated from your configured model."
    }
  ],
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "ok": {
        "type": "boolean"
      },
      "modelEcho": {
        "type": "string"
      }
    },
    "required": [
      "ok",
      "modelEcho"
    ],
    "additionalProperties": false
  }
}
2025-09-17T09:16:28.358Z **[INFO]** Raw content {"ok": true, "modelEcho": "iPhone 13 Pro"}
2025-09-17T09:16:28.360Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:16:28.360Z **[INFO]** Ollama payload {
  "model": "llama3.1:latest",
  "messages": [
    {
      "role": "system",
      "content": "You are a strict JSON API. Return only valid JSON per the schema."
    },
    {
      "role": "user",
      "content": "Return {\"ok\":true, \"modelEcho\": \"<model>\" } with <model> populated from your configured model."
    }
  ],
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "ok": {
        "type": "boolean"
      },
      "modelEcho": {
        "type": "string"
      }
    },
    "required": [
      "ok",
      "modelEcho"
    ],
    "additionalProperties": false
  },
  "temperature": 0
}
2025-09-17T09:16:29.748Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:16:29.749Z **[ERROR]** {}
2025-09-17T09:16:29.750Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:16:29.750Z **[ERROR]** {}
2025-09-17T09:16:29.751Z **[INFO]** Ollama: parsed OK
2025-09-17T09:16:29.752Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:18:34.523Z **[INFO]** Raw content {"ok":true,"modelEcho":"A strict JSON API"}
2025-09-17T09:18:34.530Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:18:36.029Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:18:36.041Z **[ERROR]** {}
2025-09-17T09:18:36.041Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:18:36.041Z **[ERROR]** {}
2025-09-17T09:18:36.042Z **[INFO]** Ollama: parsed OK
2025-09-17T09:18:36.042Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:19:28.417Z **[INFO]** Raw content {"ok":true,"modelEcho":"<a i 18 0 1 0.5 rgb(255,0,0) circle at 100 200/>"}
2025-09-17T09:19:28.422Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:19:30.592Z **[INFO]** Ollama: raw text: {"model":"llama3.1:latest","created_at":"2025-09-17T09:19:30.587782Z","message":{"role":"assistant","content":"{\"ok\": true, \"modelEcho\": \"A strict JSON API that returns only valid JSON\"}"},"done_reason":"stop","done":true,"total_duration":2164431709,"load_duration":101930209,"prompt_eval_count":54,"prompt_eval_duration":87966916,"eval_count":21,"eval_duration":1970691709}
2025-09-17T09:19:30.593Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:19:30.595Z **[ERROR]** {}
2025-09-17T09:19:30.595Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:19:30.595Z **[ERROR]** {}
2025-09-17T09:19:30.596Z **[INFO]** Ollama: parsed OK
2025-09-17T09:19:30.597Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:20:20.269Z **[INFO]** Raw content {"ok": true, "modelEcho": "Model: IBM Watson Assistant"}
2025-09-17T09:20:20.275Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:20:22.002Z **[INFO]** Ollama: raw text: [object Object]
2025-09-17T09:20:22.003Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:20:22.005Z **[ERROR]** {}
2025-09-17T09:20:22.006Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:20:22.007Z **[ERROR]** {}
2025-09-17T09:20:22.007Z **[INFO]** Ollama: parsed OK
2025-09-17T09:20:22.009Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:20:57.763Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "ResNet-50"
}
2025-09-17T09:20:57.769Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:20:59.488Z **[INFO]** Ollama: raw text: {
  "model": "llama3.1:latest",
  "created_at": "2025-09-17T09:20:59.486377Z",
  "message": {
    "role": "assistant",
    "content": "{\n  \"ok\": true,\n  \"modelEcho\": \"Linear Regression\"\n}"
  },
  "done_reason": "stop",
  "done": true,
  "total_duration": 1712239500,
  "load_duration": 107552458,
  "prompt_eval_count": 54,
  "prompt_eval_duration": 90432667,
  "eval_count": 18,
  "eval_duration": 1507063875
}
2025-09-17T09:20:59.490Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:20:59.492Z **[ERROR]** {}
2025-09-17T09:20:59.492Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:20:59.493Z **[ERROR]** {}
2025-09-17T09:20:59.493Z **[INFO]** Ollama: parsed OK
2025-09-17T09:20:59.494Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:22:35.810Z **[INFO]** Raw content {
  "ok": true,
  "modelEcho": "A strict JSON API"
}
2025-09-17T09:22:35.813Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:22:37.495Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:22:37.497Z **[ERROR]** {}
2025-09-17T09:22:37.498Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:22:37.498Z **[ERROR]** {}
2025-09-17T09:22:37.498Z **[INFO]** Ollama: parsed OK
2025-09-17T09:22:37.499Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:23:45.384Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:23:46.711Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:23:46.712Z **[ERROR]** {}
2025-09-17T09:23:46.713Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:23:46.713Z **[ERROR]** {}
2025-09-17T09:23:46.713Z **[INFO]** Ollama: parsed OK
2025-09-17T09:23:46.714Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:27:42.392Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:27:43.767Z **[ERROR]** {}
2025-09-17T09:27:43.770Z **[INFO]** Ollama: extracted content: [object Object]
2025-09-17T09:27:43.770Z **[ERROR]** {}
2025-09-17T09:27:43.771Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "object". Raw: [object Object]
2025-09-17T09:27:43.771Z **[ERROR]** {}
2025-09-17T09:27:43.771Z **[INFO]** Ollama: parsed OK
2025-09-17T09:27:43.772Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:28:41.121Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:28:42.349Z **[INFO]** Ollama: extracted content: {"model":"llama3.1:latest","created_at":"2025-09-17T09:28:42.348368Z","message":{"role":"assistant","content":"{\"ok\":true,\"modelEcho\":\"JSON API\"}"},"done_reason":"stop","done":true,"total_duration":1223961916,"load_duration":118556333,"prompt_eval_count":54,"prompt_eval_duration":109200292,"eval_count":12,"eval_duration":993993000}
2025-09-17T09:28:42.351Z **[ERROR]** {}
2025-09-17T09:28:42.352Z **[INFO]** Ollama: parsed OK
2025-09-17T09:28:42.352Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:29:49.916Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:29:51.134Z **[INFO]** Ollama: extracted content: undefined
2025-09-17T09:29:51.136Z **[ERROR]** {}
2025-09-17T09:29:51.137Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:29:51.137Z **[ERROR]** {}
2025-09-17T09:29:51.137Z **[INFO]** Ollama: parsed OK
2025-09-17T09:29:51.138Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:30:15.696Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:30:16.835Z **[INFO]** Ollama: extracted content: {"model":"llama3.1:latest","created_at":"2025-09-17T09:30:16.832386Z","message":{"role":"assistant","content":"{\"ok\":true,\"modelEcho\":\"JSON API\"}"},"done_reason":"stop","done":true,"total_duration":1133151916,"load_duration":93101666,"prompt_eval_count":54,"prompt_eval_duration":83430042,"eval_count":12,"eval_duration":955508583}
2025-09-17T09:30:16.838Z **[ERROR]** {}
2025-09-17T09:30:16.839Z **[INFO]** Ollama: parsed OK
2025-09-17T09:30:16.840Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:31:16.280Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:31:17.969Z **[INFO]** Ollama: extracted content {
  "model": "llama3.1:latest",
  "created_at": "2025-09-17T09:31:17.967318Z",
  "message": {
    "role": "assistant",
    "content": "{\"ok\": true, \"modelEcho\": \"A strict JSON API\"}"
  },
  "done_reason": "stop",
  "done": true,
  "total_duration": 1682267083,
  "load_duration": 105490291,
  "prompt_eval_count": 54,
  "prompt_eval_duration": 119591250,
  "eval_count": 16,
  "eval_duration": 1455573416
}
2025-09-17T09:31:17.971Z **[ERROR]** {}
2025-09-17T09:31:17.972Z **[INFO]** Ollama: parsed OK
2025-09-17T09:31:17.973Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:32:39.010Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:32:40.878Z **[ERROR]** {}
2025-09-17T09:32:40.879Z **[ERROR]** Ollama JSON parse failed: JSON Parse error: Unexpected identifier "undefined". Raw: undefined
2025-09-17T09:32:40.879Z **[ERROR]** {}
2025-09-17T09:32:40.879Z **[INFO]** Ollama: parsed OK
2025-09-17T09:32:40.880Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:34:22.766Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:34:23.856Z **[INFO]** Ollama: extracted content {
  "model": "llama3.1:latest",
  "created_at": "2025-09-17T09:34:23.853821Z",
  "message": {
    "role": "assistant",
    "content": "{\"ok\":true,\"modelEcho\":\"BERT\"}"
  },
  "done_reason": "stop",
  "done": true,
  "total_duration": 1081774083,
  "load_duration": 106980875,
  "prompt_eval_count": 54,
  "prompt_eval_duration": 83002625,
  "eval_count": 11,
  "eval_duration": 890852041
} {"model":"llama3.1:latest","created_at":"2025-09-17T09:34:23.853821Z","message":{"role":"assistant","content":"{\"ok\":true,\"modelEcho\":\"BERT\"}"},"done_reason":"stop","done":true,"total_duration":1081774083,"load_duration":106980875,"prompt_eval_count":54,"prompt_eval_duration":83002625,"eval_count":11,"eval_duration":890852041}
2025-09-17T09:34:23.857Z **[ERROR]** {}
2025-09-17T09:34:23.857Z **[INFO]** Ollama: parsed OK
2025-09-17T09:34:23.858Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:35:30.382Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:35:31.811Z **[INFO]** Ollama: extracted content
2025-09-17T09:35:31.814Z **[ERROR]** {}
2025-09-17T09:35:31.814Z **[INFO]** Ollama: parsed OK
2025-09-17T09:35:31.816Z **[ERROR]** Service parse failed ok is not defined
2025-09-17T09:36:25.880Z **[INFO]** Ollama: request start (model=llama3.1:latest)
2025-09-17T09:36:26.968Z **[INFO]** Ollama: extracted {"ok":true,"modelEcho":"BERT"}
2025-09-17T09:36:26.969Z **[INFO]** Ollama: parsed OK
2025-09-17T09:36:26.970Z **[ERROR]** Service parse failed ok is not defined
