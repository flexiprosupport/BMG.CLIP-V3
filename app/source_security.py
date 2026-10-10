"""URL validation plus per-connection public-address enforcement for downloads.

The download subprocess installs the socket guards: redirects, extractor/CDN
requests and DNS rebinding must pass the same check, not just the first URL.
"""
import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit, parse_qs
from .models import InvalidVideoURLError

HOSTS = ("youtube.com","youtu.be","youtube-nocookie.com","vimeo.com",
         "dailymotion.com","dai.ly","twitch.tv","tiktok.com","instagram.com",
         "facebook.com","fb.watch","twitter.com","x.com")

def validate_source(url):
    try:
        value = (url or "").strip()
        u = urlsplit(value)
        host = (u.hostname or "").lower().rstrip(".")
        if len(value)>4096 or u.scheme not in ("http","https") or not host or u.username or u.password or u.port not in (None,80,443):
            raise ValueError()
        try:
            if not ipaddress.ip_address(host).is_global:
                raise ValueError()
        except ValueError:
            if ":" in host or re.fullmatch(r"[0-9.]+",host):
                raise ValueError()
        if not any(host==h or host.endswith("."+h) for h in HOSTS) and not u.path.lower().endswith((".mp4",".webm",".mov",".mkv",".m4v")):
            raise ValueError()
        return urlunsplit((u.scheme, u.netloc, u.path, u.query, ""))
    except (ValueError,TypeError):
        raise InvalidVideoURLError("Use a public supported video link or direct video URL. Local/private addresses, credentials and custom ports are not allowed.")

def identity(url):
    u=urlsplit(validate_source(url))
    host=(u.hostname or "").lower()
    if host.endswith("youtube.com") or host=="youtu.be":
        video=parse_qs(u.query).get("v",[None])[0] or u.path.strip("/").split("/")[-1]
        return "youtube:"+video
    return urlunsplit((u.scheme.lower(),u.netloc.lower(),u.path.rstrip("/"),u.query,""))

def public_address(value):
    try:
        ip=ipaddress.ip_address(str(value).split("%")[0])
        if not ip.is_global or ip.is_multicast or ip.is_reserved or (ip.version==6 and ip.ipv4_mapped and not ip.ipv4_mapped.is_global):
            raise ValueError()
    except ValueError:
        raise OSError("Private or non-public network destination blocked.")

def install_network_guard():
    original_resolve=socket.getaddrinfo
    original_connect=socket.socket.connect
    original_connect_ex=socket.socket.connect_ex
    def resolve(*args,**kwargs):
        answers=original_resolve(*args,**kwargs)
        for family,_,_,_,address in answers:
            if family in (socket.AF_INET,socket.AF_INET6):
                public_address(address[0])
        return answers
    def connect(sock,address):
        if sock.family in (socket.AF_INET,socket.AF_INET6):
            public_address(address[0])
        return original_connect(sock,address)
    def connect_ex(sock,address):
        if sock.family in (socket.AF_INET,socket.AF_INET6):
            public_address(address[0])
        return original_connect_ex(sock,address)
    socket.getaddrinfo=resolve
    socket.socket.connect=connect
    socket.socket.connect_ex=connect_ex

