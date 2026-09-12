async function win(op) {
    await fetch('/__window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op }),
    })
}

export const Window = {
    Minimise: () => win('minimize'),
    Maximise: () => win('maximize'),
    UnMaximise: () => win('unmaximize'),
    IsMaximised: async () => {
        const r = await fetch('/__window?op=isMaximized')
        const j = await r.json()
        return !!j.maximized
    },
    Hide: () => win('hide'),
    Show: () => win('show'),
    Close: () => win('close'),
}

const eventListeners = new Map()

export const Events = {
    On(name, cb) {
        const list = eventListeners.get(name) || []
        list.push(cb)
        eventListeners.set(name, list)
        return {
            off() {
                const cur = eventListeners.get(name) || []
                eventListeners.set(name, cur.filter((fn) => fn !== cb))
            },
        }
    },
    Emit(name, data) {
        for (const cb of eventListeners.get(name) || []) {
            try {
                cb(data)
            } catch (err) {
                console.error(err)
            }
        }
    },
}

export const Browser = {
    OpenURL: (url) => {
        fetch('/__open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url }),
        })
    },
}
