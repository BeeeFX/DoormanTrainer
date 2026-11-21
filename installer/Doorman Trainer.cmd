@echo off
rem Starts Deadlock straight into Doorman Trainer. The installer's shortcuts
rem point here. To play Deadlock normally, launch it from Steam as usual.
title Doorman Trainer
cd /d "%~dp0"
echo.
echo   Doorman Trainer
echo   ---------------
echo   Starting Deadlock in the trainer. Steam needs to be running.
echo   Keep this window open while you train; close it when you're done.
echo.
modlock.exe play mod
if errorlevel 1 (
  echo.
  echo   Something went wrong. The lines above say what.
  echo   Help: https://github.com/BeeeFX/DoormanTrainer#questions
  pause
)
