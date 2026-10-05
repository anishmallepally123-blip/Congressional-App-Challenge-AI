# Local AI Chat

A private AI assistant that runs entirely on your own computer and is used through a web page. Built for the Congressional App Challenge.

The AI model runs locally through [Ollama](https://ollama.com), so once a model is downloaded there is no internet connection, account or subscription needed, and your chats and files never leave your computer. The app checks your computer's memory and graphics card and picks a model that fits, from small laptops up to powerful desktops.

![The chat page](chatbot/screenshots/chat.png)

## What it can do

- **Chat** with a Claude-style assistant: streaming replies, an optional "Think deeper" mode, chat history with search, formatted answers and code blocks, light and dark themes, and a Listen button that reads answers out loud with your computer's own voice.
- **Pick the right model automatically**: hardware detection recommends a model and locks ones that are too big, with downloads and per-model settings right in the app.
- **Coding help**: bigger coding requests switch to a coding model that fits your computer.
- **Folder Organizer**: the AI proposes how to tidy a messy folder; nothing changes until you press Apply, and every change can be undone.
- **Shared Files**: let the AI read and answer questions from folders you choose, and see which files it looked in.
- **Connectors**: plug in third-party tools through the Model Context Protocol (MCP), with an approval card before any tool runs. 15 ready-made ones (Files, Web pages, Wikipedia, Weather, Memory, Google Drive, Google Calendar, Notion, Slack, GitHub and more) work with nothing extra to install.
- **Personalize**: teach the AI about yourself with a profile, a memory ("remember that..."), example answers it learns the style of, and your own named assistants saved as new Ollama models. Export your examples for real fine-tuning on a strong computer.
- **Use it on your phone** over your home Wi-Fi after typing a pairing code.
- **TinyGPT (experimental)**: our own small language model, built and trained from scratch on Shakespeare instead of downloaded ready-made. Download it from the Experimental section of Models; the app runs it itself, without Ollama. See [`experiments/tiny-gpt/`](experiments/tiny-gpt/README.md).

Everything is written with only Python's standard library and plain JavaScript, so there is nothing to `pip install`.

## Quick start

1. Download **LocalAIChat.zip** from the [latest release](https://github.com/anishmallepally123-blip/Congressional-App-Challenge-AI/releases/latest) and unzip it.
2. Double-click the Start file in the new folder:
   - **Windows:** `Start Local AI Chat - Windows`
   - **Mac:** `Start Local AI Chat - Mac`
3. The first time, it downloads Python and [Ollama](https://ollama.com) by itself (no admin password, nothing else to install). Your browser then opens **http://localhost:8000**, where one click downloads an AI model that fits your computer.

Step-by-step instructions, including what to click on the Windows and Mac security prompts, are in [QUICK START.txt](QUICK%20START.txt). The project website is at **https://anishmallepally123-blip.github.io/Congressional-App-Challenge-AI/**.

**Developers:** with Python 3.9+ and Ollama already installed, run `python3 chatbot/server.py`.

## Project layout

| Folder | What it is |
|---|---|
| [`chatbot/`](chatbot/README.md) | The main app: web server, chat page, hardware detection, model catalog, coding router and phone pairing |
| [`organizer/`](organizer/README.md) | Folder Organizer and Shared Files, loaded by the chatbot when this folder sits next to it |
| [`connectors/`](connectors/README.md) | MCP connectors so the AI can use third-party tools, with built-in connectors in plain Python |
| [`experiments/tiny-gpt/`](experiments/tiny-gpt/README.md) | TinyGPT: the from-scratch model's PyTorch code, training data and training scripts |
| `launcher/` | The Windows setup script used by the Start files (downloads Python and Ollama into `runtime/` on first run) |
| `docs/` | The public website (GitHub Pages): landing page, walkthrough video, download link and an in-browser demo chat |

Each folder has its own README with details.

## How it works

```
Browser (web page)  <-->  chatbot/server.py (port 8000)  <-->  Ollama (port 11434)  <-->  AI model
```

The organizer and connectors folders plug into the chatbot's server, and their pages appear in the chat's sidebar. App settings are stored in `~/.local-ai-chat/` on your computer and chats in your browser, never in this repository.

## Running the tests

```
python3 -m unittest discover -s organizer -p "test_*.py"
python3 -m unittest discover -s connectors -p "test_*.py"
python3 -m unittest discover -s chatbot -p "test_*.py"
```
