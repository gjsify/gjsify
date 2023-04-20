# Gjsify

Combine the power of Typescript with the power of GJS

## Development

### Dependencies

Fedora:

```
sudo dnf install meson vala gjs
```

Ubuntu:

```
sudo apt install meson valac gjs
```

### Build

```
NODE_OPTIONS=--max_old_space_size=9216 yarn run build
```