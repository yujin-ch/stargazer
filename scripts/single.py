"""Turn dist-single/index.html into a body-only page for the Claude preview artifact. Usage: python3 scripts/single.py out.html"""
import re, sys
s = open("dist-single/index.html").read()
head = re.search(r"<head>(.*)</head>", s, re.S).group(1)
body = re.search(r"<body>(.*)</body>", s, re.S).group(1)
head = re.sub(r"<meta charset[^>]*>\s*", "", head)
head = re.sub(r'<meta name="viewport"[^>]*>\s*', "", head)
open(sys.argv[1], "w").write(head.strip() + "\n" + body.strip() + "\n")
