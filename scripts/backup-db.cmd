@echo off
rem Weekly Tanawin database backup — run by Windows Task Scheduler.
rem Snapshots land in %USERPROFILE%\Documents\tanawin-backups\
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0.."
node scripts\backup-db.mjs >> "%USERPROFILE%\Documents\tanawin-backups\backup-log.txt" 2>&1
