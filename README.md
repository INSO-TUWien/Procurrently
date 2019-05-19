# Procurrently

## WARNING

__Installing this extension will do a git reset on every git repository opened with VS Code!__

All the changes are sent over unencrypted and unauthenticated.

## VS Code Extension

Procurrently is an experimental extension for VS Code for real time collaboration based on Git.

### Setup

To get started, the server needs to be run

```node src/server/server.js```

The IP of the server needs to be provided in the ```procurrently.bootstrapIP``` setting.

### Git checkout

Procurrently will autosave your changes and syhcnronize them to other clients. In order to checkout a different branch without committing them just open the command pallette and use the command ```Procurrently: Checkout Branch```.