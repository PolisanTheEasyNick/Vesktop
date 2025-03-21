/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2024 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { constants, existsSync, open, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Socket, createServer } from "net";
import { IpcEvents } from "shared/IpcEvents";
import { mainWin } from "./mainWindow";

const Actions = new Set([IpcEvents.TOGGLE_SELF_DEAF, IpcEvents.TOGGLE_SELF_MUTE]);

function initLinuxKeybinds() {
    const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR || process.env.TMP || "/tmp";
    const socketFile = join(xdgRuntimeDir, "vesktop-ipc");

    function createFIFO() {
        if (existsSync(socketFile)) {
            try {
                unlinkSync(socketFile);
            } catch (err) {
                console.error("Failed to remove existing mkfifo file:", err);
                return false;
            }
        }

        try {
            spawnSync("mkfifo", [socketFile]);
        } catch (err) {
            console.error("Failed to create mkfifo while initializing keybinds:", err);
            return false;
        }
        return true;
    }

    function openFIFO() {
        try {
            open(socketFile, constants.O_RDONLY | constants.O_NONBLOCK, (err, fd) => {
                if (err) {
                    console.error("Error opening pipe while initializing keybinds:", err);
                    return;
                }

                const pipe = new Socket({ fd });
                pipe.on("data", data => {
                    const action = data.toString().trim();
                    if (Actions.has(action as IpcEvents)) {
                        mainWin.webContents.send(action);
                    }
                });

                pipe.on("end", () => {
                    pipe.destroy();
                    openFIFO();
                });
            });
        } catch (err) {
            console.error("Can't open socket file.", err);
        }
    }

    function cleanup() {
        try {
            unlinkSync(socketFile);
        } catch (err) {
            console.error("Failed to cleanup socket file:", err);
        }
    }

    // Register cleanup only for Linux
    process.on("exit", cleanup);

    if (createFIFO()) {
        openFIFO();
    }
}

function initWindowsKeybinds() {
    const pipeName = "\\\\.\\pipe\\vesktop-ipc"; // Windows Named Pipe path

    function createPipeServer() {
        try {
            const server = createServer(pipe => {
                console.log("Client connected to the pipe.");

                pipe.on("data", data => {
                    const action = data.toString().trim();
                    if (Actions.has(action as IpcEvents)) {
                        mainWin.webContents.send(action);
                    } else {
                        console.warn(`Unknown action received: ${action}`);
                    }
                });

                pipe.on("end", () => {
                    console.log("Client disconnected from the pipe.");
                });

                pipe.on("error", err => {
                    console.error("Pipe error:", err);
                });
            });

            server.on("error", err => {
                console.error("Server error:", err);
            });

            server.listen(pipeName, () => {
                console.log(`Pipe server is listening on ${pipeName}`);
            });

            return server;
        } catch (err) {
            console.error("Failed to create pipe server:", err);
            return null;
        }
    }

    // No cleanup needed for Windows
    createPipeServer();
}

export function initKeybinds() {
    if (process.platform === "win32") {
        initWindowsKeybinds();
    } else {
        initLinuxKeybinds();
    }
}
