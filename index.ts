/// <reference path="../../lib/Types/Events.d.ts" />
/// <reference path="../../lib/Types/TeamSpeak.d.ts" />
import * as path from 'path';
import Plugin, { loadConfig, mergeConfig } from '../../lib/Plugin'
import Log from '../../lib/Log';
import Connection from '../../lib/Connection';
import Client from '../../lib/Client';

interface PluginConfig {
    IDLE_TIME: number,
    IDLE_CHANNEL: number
};

const defaultConfig: PluginConfig = {
    "IDLE_TIME": 900000,
    "IDLE_CHANNEL": 1
}

export default class IdleCheck extends Plugin {
    idleTimers: { [clid: number] : NodeJS.Timer };
    config: PluginConfig;

    constructor({ connection, client }: { connection: Connection, client: Client}) {
        super(connection, client);
        this.config = defaultConfig;
        this.idleTimers = {};
        this.moveClient = this.moveClient.bind(this);
    }
    init = () => {
        this._init();
    }
    async _init() {
        this.config = mergeConfig(this.config, await loadConfig(path.resolve(__dirname, "config.json")));
        this.registerEvents();
        const clientList = await this.connection.store.fetchList("clientlist");
        for (let client of clientList) {
            // Skip the bot itself
            if (client.clid === this.client.getSelf().client_id) {
                continue;
            }
            this.connection.store.fetchItem("clientinfo", client.clid).then(data => {
                if (
                    !this.idleTimers[client.clid] &&
                    client.cid != this.config.IDLE_CHANNEL
                ) {
                    const timeRemaining = Math.max(this.config.IDLE_TIME - data.client_idle_time, 0);
                    Log(`Client: ${client.clid}, time: ${timeRemaining}`, this.constructor.name, 5);
                    this.idleTimers[client.clid] = <any>setTimeout(this.moveClient, timeRemaining, client.clid);
                } else if (this.idleTimers[client.clid]) {
                    this.clearIdleTimer(client.clid);
                }
            });
        }
    }
    registerEvents() {
        this.connection.registerEvent("server", null, {
                notifyclientleftview: (param: TSEvent_ClientLeftView) => {
                    Log(`Client ${param.clid} disconnected, reason: (${param.reasonid}) ${param.reasonmsg}`, this.constructor.name, 4);
                    this.clearIdleTimer(param.clid);
                },
                notifycliententerview: (param: TSEvent_ClientEnterView) => {
                    Log(`Client ${param.clid} connected`, this.constructor.name, 4);
                    this.resetIdleTimer(param.clid);
                }
            },
            this.constructor.name);
        this.connection.registerEvent("channel", {
                id: this.config.IDLE_CHANNEL
            }, {
                notifyclientmoved: (param: TSEvent_ClientMoved) => {
                    Log(`Client ${param.clid} joined channel ${param.ctid}`, this.constructor.name, 4);
                    if (param.ctid != this.config.IDLE_CHANNEL) {
                        this.resetIdleTimer(param.clid);
                    } else {
                        this.clearIdleTimer(param.clid);
                    }
                }
            },
            this.constructor.name);
    }
    clearIdleTimer(clid: number) {
        clearTimeout(this.idleTimers[clid]);
        delete this.idleTimers[clid];
    }
    resetIdleTimer(clid: number, time = 0) {
        clearTimeout(this.idleTimers[clid]);
        this.idleTimers[clid] = <any>setTimeout(this.moveClient, Math.max(this.config.IDLE_TIME - time, 0), clid);
    }
    moveClient(clid: number) {
        this.connection.store.fetchItem("clientinfo", clid).then(client => {
            if (
                client.client_idle_time > this.config.IDLE_TIME
            ) {
                if (client.cid != this.config.IDLE_CHANNEL) {
                    Log(`Moving client ${clid} to channel ${this.config.IDLE_CHANNEL}`, this.constructor.name, 4);
                    this.connection.send("clientmove", {
                        clients: [
                            {clid}
                        ],
                        cid: this.config.IDLE_CHANNEL
                    });
                }
                this.connection.store.forceUpdateItem("clientinfo", clid, {
                    client_idle_time: 0
                });
                this.connection.store.forceUpdateList("clientlist", clid, {
                    cid: this.config.IDLE_CHANNEL
                });
            } else if (this.idleTimers[clid]) {
                Log(`Client ${clid} not idle, resetting timer`, this.constructor.name, 4);
                this.resetIdleTimer(clid, client.client_idle_time - 1000);
            }
        }).catch((err: Error) => {
            Log(`Error moving client ${clid}: ${err}`, this.constructor.name, 1);
            this.clearIdleTimer(clid);
        });
    }
    reload = () => {
        Log("IdleCheck - Already loaded!", this.constructor.name, 4);
    }
    unload = () => {
        Log("IdleCheck - Unloading...", this.constructor.name);
        if (this.connection) {
            this.connection.unregisterEvent('server', ['notifyclientleftview', 'notifycliententerview'],
                this.constructor.name);
            this.connection.unregisterEvent('channel', ['notifyclientmoved'],
                this.constructor.name);
        }

        for (let clid of Object.keys(this.idleTimers)) {
            this.clearIdleTimer(parseInt(clid, 10));
        }
    }
    disconnected = () => {
        this.unload();
    }
}
