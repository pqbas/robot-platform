# Hosts en LAN (192.168.50.0/24)

Fecha de escaneo: 2026-06-04
Herramienta: `nmap -sn 192.168.50.0/24`
Equipo de origen: `omen` (192.168.50.188, wlo1)

| IP              | Notas                          |
|-----------------|--------------------------------|
| 192.168.50.1    | Gateway/router                 |
| 192.168.50.81   | Desconocido                    |
| 192.168.50.102  | Desconocido                    |
| 192.168.50.113  | Desconocido                    |
| 192.168.50.165  | Desconocido                    |
| 192.168.50.188  | omen (esta computadora)        |

## Tailscale

| Nodo                  | IP Tailscale     |
|-----------------------|------------------|
| omen                  | 100.90.176.20    |
| labinm-robot-server   | 100.107.111.91   |

## Comandos para reusar

```bash
nmap -sn 192.168.50.0/24                 # ping-scan de la LAN
nmap -sV -O 192.168.50.<ip>              # identificar servicio y SO
tailscale status                         # nodos en la tailnet
```
