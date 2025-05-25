import sys
from PyQt5.QtWidgets import QApplication
from virtual_painter_gui import VirtualPainterGUI  

def main():
    app = QApplication(sys.argv)
    painter_gui = VirtualPainterGUI() 
    painter_gui.show()  
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()
