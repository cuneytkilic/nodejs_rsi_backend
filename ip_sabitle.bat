@echo off
set domain=cryptosignalmonitoring.duckdns.org
set token=584b606a-51c9-4c37-8ce9-73c000290980
curl "https://www.duckdns.org/update?domains=%domain%&token=%token%&ip="
pause
