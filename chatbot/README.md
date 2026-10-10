# Local AI Chat

A Claude-style chatbot that runs entirely on your own computer. The AI model runs locally through [Ollama](https://ollama.com), and you chat with it in your web browser. No internet connection or account is needed once the model is downloaded, and your chats never leave your computer.

**Features**

- A setup guide on first launch that checks Ollama is running and walks you through getting a model, with no typing in a terminal
- Checks your computer's memory, graphics card and disk space, recommends the best model for it, and locks models that are too big so the computer doesn't freeze
- Download, switch and remove models from the app, with a progress bar
- Automatic coding help: simple code questions stay with the chat model, but bigger projects (a game, website, app, or debugging real code) switch to a coding model that fits your computer. The reply shows which model answered, and you can turn this off in Settings
- Uses files from folders you share (when the Folder Organizer is installed), and says which files it looked in
- Adjustable settings for each model, saved separately per model: creativity, answer length, conversation memory (sizes too big for the computer are locked), and custom instructions
- Replies stream in word by word, with an optional "Think deeper" mode that shows the AI's reasoning
- Chat history saved in your browser, grouped by day, with search, rename and delete
- Edit a message you sent, retry an answer, and copy answers or code with one click
- Formatted answers: headings, lists, tables and code blocks
- Settings for text size and light or dark mode, and a layout that works on phones and narrow windows
- A link to the Folder Organizer when it's installed next to this folder
- **Settings > Your data** shows everything the app keeps, where each file is on your computer and how big it is, and what the app talks to over the network, so you can check for yourself that nothing leaves your computer ([screenshot](screenshots/your-data.png))

## Which model should I use?

You don't have to decide: the app checks your computer and marks one model **Recommended for you**. A model that runs on a laptop is much smaller than cloud AI like Claude, so it knows less and makes more mistakes. Bigger is smarter but needs more memory. The lineup runs from phone-sized models to ones for 64 GB computers:

| Size | Chat models | Coding models | Good for |
|---|---|---|---|
| 📱 Phone size | Qwen 3 Micro (`qwen3:0.6b`), Qwen 3 Tiny (`qwen3:1.7b`), Gemma 3 Mini (`gemma3:1b`) | Qwen Coder Tiny (`qwen2.5-coder:1.5b`) | 4 GB computers, quick simple answers |
| 💻 Laptop size | Qwen 3 Small (`qwen3:4b`), Qwen 3 Medium (`qwen3:8b`), Gemma 3 Small (`gemma3:4b`) | Qwen Coder Small and Medium (`3b`, `7b`) | 8 to 16 GB laptops |
| 🖥️ Desktop size | Qwen 3 Large (`qwen3:14b`), Gemma 3 Medium (`gemma3:12b`) | Qwen Coder Large (`14b`) | 32 GB, or a graphics card with 12 GB or more |
| 🖥️ 32 to 64 GB | Qwen 3 Extra Large (`qwen3:30b`), Gemma 3 Large (`gemma3:27b`), Llama 3.3 Huge (`llama3.3:70b`, needs 64 GB) | Qwen Coder Extra Large (`32b`) | Powerful desktops and workstations |

The Qwen and Llama models can use tools, which the folder organizer and connectors need; Gemma can't. Each model is rated **Fast** (fits on your graphics card or Apple chip), **Runs well**, **Slow**, or **Locked** (too big). You can still install other models with `ollama pull <name>`; the app rates and locks those too.

## Using it on your phone

The AI runs on your computer, and your phone can use it over the same Wi-Fi:

1. On the computer, open **Settings** and turn **Use on your phone** on. It shows an address and a 6-digit code.
2. On your phone (connected to the same Wi-Fi), open that address in the browser and type the code.

The first time, Windows may ask whether to let Python use your network; click **Allow** for private networks. Phones can chat and switch models, but can't download models, change settings, or use the folder organizer, shared files or connectors. Turning it off disconnects every phone. Only turn it on with Wi-Fi you trust, like at home.

Running a model directly on a phone, with no computer, would need a separate phone app; this project is a web app, so it doesn't do that. The 📱 phone-size models are the ones such an app could run.

## Setup (one time)

### Windows

1. Install **Python 3** from [python.org/downloads](https://www.python.org/downloads/). On the first installer screen, tick **"Add python.exe to PATH"**.
2. Install **Ollama** from [ollama.com/download](https://ollama.com/download). It starts automatically and sits in the system tray.

### Mac

1. Python 3 is usually already installed. Check by opening **Terminal** and typing `python3 --version`. If it asks to install developer tools, click Install.
2. Install **Ollama** from [ollama.com/download](https://ollama.com/download), drag it to Applications and open it once. A llama icon appears in the menu bar.

Then start the app (below). The setup guide on the page downloads the right model for you.

## Running the app

Make sure Ollama is running (look for its icon in the system tray or menu bar), then:

- **Windows:** double-click `start-windows.bat`
- **Mac:** double-click `start-mac.command` (the first time, right-click it and choose **Open** to get past the security warning)

Or from a terminal in this folder: `python server.py` on Windows, `python3 server.py` on Mac.

Your browser opens **http://localhost:8000** automatically. To stop the app, close the terminal window or press **Ctrl+C** in it.

## How it works

```
Browser (static/)  <-->  server.py (port 8000)  <-->  Ollama (port 11434)  <-->  AI model
```

- `server.py` is a small Python web server using only the standard library. It serves the web page, forwards each chat to Ollama and streams the reply back, and handles model downloads.
- `hardware.py` detects memory (RAM), graphics cards and their memory (VRAM), and free disk space on Windows, Mac and Linux. Run `python hardware.py` to see what it finds.
- `models.py` holds the list of models and the rules for rating and locking them.
- `phone.py` lets phones on the same Wi-Fi use the app after typing a code.
- `personal.py` stores what you teach the AI on the Personalize page (`static/personal.html`) and adds it to each chat. See "Teaching the AI about you" below.
- `tinygpt.py` downloads and runs TinyGPT, the experimental model trained from scratch in `../experiments/tiny-gpt`. It runs in plain Python inside the app instead of in Ollama, and continues your text in Shakespeare's style rather than answering questions.
- `router.py` decides when a message is a bigger coding project that should go to a coding model.
- `static/index.html`, `style.css` and `app.js` are the chat page. Chats are saved in the browser's local storage.
- `static/markdown.js` turns the model's Markdown into formatted text. It is built in so the app works offline, and it escapes HTML so a reply can't run code in the page.
- The system prompt that sets the assistant's personality is at the top of `server.py`.

## Teaching the AI about you

The models are downloaded unchanged from the companies that made them (Qwen from Alibaba, Gemma from Google, Llama from Meta). Open **🧠 Personalize** in the sidebar to teach yours without retraining it:

- **About me**: your name, a bit about you, and how you like answers. Added to every chat.
- **Memory**: facts to keep in mind. Type "remember that my essay is due Friday" in a chat and it is saved here.
- **Teach by example**: press **👍 Teach** under a good answer, or write a question and the answer you want. The few saved examples most like each new question are sent before it, so the model copies their style (this is called few-shot prompting).
- **Your own assistants**: a name, a model to build on, instructions and a creativity level. The app asks Ollama to create a new model from them (`/api/create`), so it shows up in the model list and in `ollama list`. Deleting it removes only that new model.
- **See what the AI is told** shows exactly the text the app adds, so nothing is hidden.

A switch at the top turns all of it off. It is saved in `~/.local-ai-chat/personal.json` and never leaves the computer. Phones can chat with it but can't change it.

### Advanced: real fine-tuning (not done by the app)

Fine-tuning changes the model's weights and needs an NVIDIA graphics card with 8 GB or more (or an Apple M-series Mac), extra Python packages and some patience, so the app doesn't do it. What it does is export your examples with **Download my examples (.jsonl)**: one `{"messages": [...]}` conversation per line, the format most fine-tuning tools read. With [Unsloth](https://github.com/unslothai/unsloth) (NVIDIA) or [MLX-LM](https://github.com/ml-explore/mlx-lm) (Mac) you can train a LoRA adapter on that file for the same base model you use here, then load it in Ollama with a Modelfile like:

```
FROM qwen3:4b
ADAPTER ./my-adapter.gguf
```

and `ollama create my-model -f Modelfile`. You need dozens to hundreds of good examples for this to help. This path hasn't been tested with this app.

## Troubleshooting

- **"Ollama is not running"**: open the Ollama app, then refresh the page.
- **A model is locked**: it needs more memory than this computer has. Pick a smaller one; the reason is shown under each model.
- **Replies are very slow**: switch to a smaller model, and close other heavy apps.
- **Port 8000 is already in use**: run with another port, for example `PORT=8080 python3 server.py` on Mac or `set PORT=8080 && python server.py` on Windows.
