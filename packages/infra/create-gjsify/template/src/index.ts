import Gtk from 'gi://Gtk?version=4.0'

const app = new Gtk.Application({
    applicationId: 'org.gjsify.example',
})

app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'Hello from Gjsify',
        defaultWidth: 400,
        defaultHeight: 300,
    })

    const label = new Gtk.Label({
        label: 'Hello from Gjsify!',
    })

    window.set_child(label)
    window.present()
})

app.run([])
