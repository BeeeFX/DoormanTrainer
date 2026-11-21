@echo off
rem Starts Deadlock straight into Doorman Trainer; the installer's shortcuts
rem point here. The work is in launcher.ps1: update, start, stop with the game.
rem One line on purpose: an update rewrites this file while it runs, and cmd
rem reads a batch file as it goes.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" & exit /b
