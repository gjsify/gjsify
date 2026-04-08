import Gtk from 'gi://Gtk?version=4.0'

// Globals injected via --globals in the build script:
//   process  → Node.js process API   (@gjsify/process)
//   crypto   → Web Crypto API        (@gjsify/webcrypto)
//   Buffer   → Node.js Buffer API    (@gjsify/buffer)

const app = new Gtk.Application({
    applicationId: 'org.gjsify.example',
})

app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'new-gjsify-app',
        defaultWidth: 480,
        defaultHeight: 280,
    })

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 16,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
    })

    // Node.js — process API
    const platformLabel = new Gtk.Label({
        label: `Platform: ${process.platform}  |  PID: ${process.pid}`,
        xalign: 0,
    })

    // Web Crypto API — UUID
    const uuidLabel = new Gtk.Label({
        label: 'UUID:   —',
        xalign: 0,
    })

    // Node.js — Buffer API
    const base64Label = new Gtk.Label({
        label: 'Base64: —',
        xalign: 0,
    })

    // Button wires everything together
    const button = new Gtk.Button({ label: '↺  Generate UUID' })
    button.connect('clicked', () => {
        const uuid = crypto.randomUUID()                          // Web Crypto
        const base64 = Buffer.from(uuid).toString('base64')      // Node.js Buffer
        uuidLabel.set_label(`UUID:   ${uuid}`)
        base64Label.set_label(`Base64: ${base64}`)
    })

    box.append(platformLabel)
    box.append(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }))
    box.append(button)
    box.append(uuidLabel)
    box.append(base64Label)

    window.set_child(box)
    window.present()
})

app.run([])
