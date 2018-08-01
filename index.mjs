import path from 'path';
import Plugin from '../../lib/Plugin'

const defaultConfig = {
    "IDLE_TIME": 900000,
    "IDLE_CHANNEL": 1
}

export const VERSION = 1;
export default class IdleCheck extends Plugin {
    constructor() {
        super(defaultConfig);
        this.idleTimers = {};
        this.moveClient = this.moveClient.bind(this);
    }
    async init() {
        await this.loadConfig((path.dirname(import.meta.url) + '/config.json'));
        this.registerEvents();
        const clientList = await this.connection.store.fetchList('clientlist', true);
        for (let client of clientList) {
            const data = await this.connection.store.fetchInfo('clientinfo', 'clid', client.clid);
            if (
                !this.idleTimers[client.clid] &&
                client.cid != this.config.IDLE_CHANNEL
            ) {
                this.idleTimers[client.cid] = setTimeout(this.moveClient, Math.max(this.config.IDLE_TIME - data.client_idle_time, 0), client.clid);
            } else if (this.idleTimers[client.clid]) {
                this.clearIdleTimer(client.clid);
            }
        }
    }
    registerEvents() {
        this.connection.registerEvent('server', undefined, {
            notifyclientleftview: (param) => {
                this.clearIdleTimer(param.clid);
            },
            notifycliententerview: (param) => {
                clearTimeout(this.idleTimers[param.clid]);
                this.idleTimers[param.clid] = setTimeout(this.moveClient, this.config.IDLE_TIME, param.clid);
            }
        }, import.meta.url);
        this.connection.registerEvent('channel', {id: this.config.IDLE_CHANNEL}, {
            notifyclientmoved: (param) => {
                if (param.ctid != this.config.IDLE_CHANNEL) {
                    clearTimeout(this.idleTimers[param.clid]);
                    this.idleTimers[param.clid] = setTimeout(this.moveClient, this.config.IDLE_TIME, param.clid);
                } else {
                    this.clearIdleTimer(param.clid);
                }
            }
        }, import.meta.url);
    }
    clearIdleTimer(clid) {
        clearTimeout(this.idleTimers[clid]);
        delete this.idleTimers[clid];
    }
    moveClient(clid) {
        this.connection.store.fetchInfo('clientinfo', 'clid', clid, true).then(client => {
            if (
                client.client_idle_time > this.config.IDLE_TIME
            ) {
                if (client.cid != this.config.IDLE_CHANNEL) {
                    this.connection.send('clientmove', {clid, cid: this.config.IDLE_CHANNEL});
                }
                this.connection.store.forceInfoUpdate('clientinfo', clid, {client_idle_time: 0});
                this.connection.store.forceListUpdate('clientlist', 'clid', clid, {cid: this.config.IDLE_CHANNEL});
            } else if (this.idleTimers[clid]) {
                clearTimeout(this.idleTimers[clid]);
                this.idleTimers[client.clid] = setTimeout(this.moveClient, Math.max(this.config.IDLE_TIME - client.client_idle_time, 0), clid);
            }
        }).catch(err => {
            this.clearIdleTimer(clid);
        });
    }
    reload() {
        console.log("IdleCheck - Already loaded!");
    }
    unload() {
        console.log("IdleCheck - Unloading...");
        if (this.connection) {
            this.connection.unregisterEvent('server', ['notifyclientleftview', 'notifycliententerview'], import.meta.url);
            this.connection.unregisterEvent('channel', ['notifyclientmoved'], import.meta.url);
        }

        for (let clid of Object.keys(this.idleTimers)) {
            this.clearIdleTimer(clid);
        }
    }
    disconnected() {
        this.unload();
    }
}
