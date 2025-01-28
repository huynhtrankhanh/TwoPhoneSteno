# TwoPhoneSteno
cheaper than a professional stenotype machine and yet more ergonomic

Command to emulate serial device: `sudo socat -d -d pty,raw,echo=0,link=/dev/ttyS30,user=$(whoami),mode=600 UNIX-CONNECT:/tmp/wowserial`
