#!/usr/bin/env python3

import time
import random
import threading
import sys
from datetime import datetime

class OffstrapDevice:
    def __init__(self):
        self.connected = False
        self.locked = True
        self.code_generated = False
        self.location_sent = False
        self.device_status_sent = False
        
    def print_banner(self):
        banner = """
  ██████╗ ███████╗███████╗███████╗████████╗██████╗  █████╗ ██████╗ 
 ██╔═══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗
 ██║   ██║█████╗  █████╗  ███████╗   ██║   ██████╔╝███████║██████╔╝
 ██║   ██║██╔══╝  ██╔══╝  ╚════██║   ██║   ██╔══██╗██╔══██║██╔═══╝ 
 ╚██████╔╝██║     ██║     ███████║   ██║   ██║  ██║██║  ██║██║     
  ╚═════╝ ╚═╝     ╚═╝     ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     
                                                                   
                     ██████╗ ███████╗██╗   ██╗██╗ ██████╗███████╗ 
                     ██╔══██╗██╔════╝██║   ██║██║██╔════╝██╔════╝ 
                     ██║  ██║█████╗  ██║   ██║██║██║     █████╗   
                     ██║  ██║██╔══╝  ╚██╗ ██╔╝██║██║     ██╔══╝   
                     ██████╔╝███████╗ ╚████╔╝ ██║╚██████╗███████╗ 
                     ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝ ╚═════╝╚══════╝ 
"""
        print(banner)
        
    def print_boot(self):
        boot_messages = [
            "bootloader v2.3.1",
            "nRF52840 ready",
            "flash: 1MB | ram: 256KB", 
            "ble stack init...",
            "loading firmware...",
            "████████████████████████ 100%",
            "firmware ready",
            "starting os...",
        ]
        
        for msg in boot_messages:
            print(f"{msg}")
            time.sleep(0.2)
        
        print("\n" + "-"*50)
        print(f"firmware version 1.1")
        print(f"device: OFF-{random.randint(10000, 99999)}")
        print(f"time: {datetime.now().strftime('%H:%M:%S')}")
        print("-"*50 + "\n")
        
    def print_status(self):
        if not self.connected:
            print("ble - disconnected")
            print("")
        else:
            print("ble - connected")
    
    def connect(self):
        print("connecting...")
        time.sleep(0.5)
        print("device found")
        time.sleep(0.3)
        print("pairing...")
        time.sleep(0.5)
        self.connected = True
        print("connected\n")
        
    def generate_code(self):
        print("auth...")
        time.sleep(0.8)
        code = random.randint(1000, 9999)
        print(f"codeGen - {code}\n")
        self.code_generated = True
        
    def send_status(self):
        print("reading sensors...")
        time.sleep(0.6)
        print(f"battery: {random.randint(85, 100)}%")
        print(f"temp: {random.randint(20, 25)}c")
        print("device status sent")
        
        time.sleep(0.4)
        print("fetching location")
        time.sleep(1)
        
        lat = round(28.6139 + random.uniform(-0.05, 0.05), 6)
        lon = round(77.2090 + random.uniform(-0.05, 0.05), 6)
        
        print(f"gps: {lat}, {lon}")
        print("location sent\n")
        
        self.device_status_sent = True
        self.location_sent = True
        
    def unlock(self):
        print("unlocking...")
        time.sleep(0.5)
        print("unlocked\n")
        self.locked = False
        
        # auto lock after 3 sec
        threading.Timer(3.0, self.auto_lock).start()
        
    def auto_lock(self):
        self.locked = True
        print("locked")
        print("\n")
        
    def run(self):
        try:
            print("\033[2J\033[H")  # clear screen
            self.print_banner()
            print("initializing...\n")
            time.sleep(0.5)
            self.print_boot()
            self.print_status()
            
            while True:
                if not self.connected:
                    input()
                    self.connect()
                    continue
                    
                elif not self.code_generated:
                    input()
                    self.generate_code()
                    continue
                    
                elif not self.device_status_sent:
                    input()
                    self.send_status()
                    continue
                    
                elif self.locked:
                    input()
                    self.unlock()
                    continue
                else:
                    input()
                    
        except KeyboardInterrupt:
            print("\nconnection closed")
            sys.exit(0)

if __name__ == "__main__":
    print("offstrap device interface")
    print("com11 | nrf52840 | v1.1")
    print("-"*30 + "\n")
    
    device = OffstrapDevice()
    device.run()