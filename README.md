# Saathi-Web

Saathi-Web is a lightweight web-based client for interacting with Large Language Models (LLMs). It provides a clean, user-friendly interface for chatting with various AI providers, managing conversations, and organizing prompts with a tree-based structure.

## Features

- **Multi-provider support**: Connect to different LLM providers through a unified interface
- **Conversation management**: Create, organize, and navigate through multiple conversations
- **Tree-based organization**: Structure prompts and responses in a hierarchical tree view
- **Markdown rendering**: Beautiful rendering of code blocks, tables, and formatted content
- **Local-first**: Runs entirely in your browser with no backend required

## Getting Started

### Pright out of the box

Simply open `index.html` in your browser to start using Saathi-Web.

### Running with a local server

Some providers may have CORS restrictions that prevent direct file access. To run with a local server, you can use any of the following:

```bash
# Using Python 3
python3 -m http.server 8000

# Using Node.js (with http-server)
npx http-server

# Using PHP
php -S localhost:8000
```

Then navigate to `http://localhost:8000`.

## Project Structure

```
Saathi-Web/
├── index.html        # Main application entry point
├── css/              # Stylesheets
├── js/               # JavaScript modules
│   ├── main.js       # Core application logic
│   ├── providers.js  # LLM provider configurations
│   ├── tree.js       # Tree structure implementation
│   ├── markdown.js   # Markdown rendering
│   └── web-bridge.js # Web-to-API bridge
└── README.md         # This file
```

## Usage

1. Open the application in your browser
2. Configure your LLM provider(s) in the settings
3. Start a new conversation and begin chatting
