import tkinter as tk
from tkinter import scrolledtext
import logging
import os
import sys

pth = os.path.realpath(os.path.join(os.getcwd(), './prog'))
if not pth in sys.path:
    sys.path.append(pth)
from weather_data_from_metno import update_weather_data, make_data_file

path = os.path.dirname(os.path.abspath(__file__))  # path of this file
print(path)
#path = '/home/larsmo/div/ffr/merge/ffr_analysis/'
# this file must currently be put in the parent folder
DATA_FILE_NAME = os.path.join(path, 'metno_data.pickle')

class ClientIDPopup:
    def __init__(self,filename=None):
        self.root = tk.Tk()
        self.client_id = None
        self.id_file = filename
        self.setup_widgets()

    def save_client_id(self):
        self.client_id = self.client_id_entry.get()
        try:
            with open(self.id_file, 'w') as file:
                file.write(self.client_id)
            self.status_label.config(text='Client ID saved successfully.')
            self.root.destroy()  # Close the window after saving
        except Exception as e:
            self.status_label.config(text=f'Error saving Client ID: {e}')

    def setup_widgets(self):
        text_area = scrolledtext.ScrolledText(self.root, height=10, width=70)
        text_area.grid(column=0, row=0, pady=10, padx=10, columnspan=2)
        instructions = (
            "Client id for met.no not set. You can get a client ID from\n"
            "https://frost.met.no/auth/requestCredentials.html\n"
            "Client id can be then be set with the command\n"
            "set_client_id('<your_client_id>')\n"
            "For now, if you have a client ID, enter it here:\n"
        )
        text_area.insert(tk.INSERT, instructions)
        text_area.config(state='disabled')

        self.client_id_entry = tk.Entry(self.root, width=58)
        self.client_id_entry.grid(column=0, row=1, pady=10, padx=10)

        save_button = tk.Button(self.root, text="Save Client ID", command=self.save_client_id)
        save_button.grid(column=1, row=1, sticky=tk.W+tk.E, padx=10)

        self.status_label = tk.Label(self.root, text="")
        self.status_label.grid(column=0, row=2, columnspan=2, pady=10)

    def show(self):
        self.root.mainloop()
        return self.client_id

if __name__ == '__main__':
    try:
        id_file = os.path.join(path, 'metno_client_id.txt')
        client_id = [open(id_file).readlines()[0].strip()]
        print(id_file + ' FOUND')
    except FileNotFoundError:
        print(id_file + ' not  NOW')
        client_id = [None]

    if client_id[0] is None:
        popup = ClientIDPopup(id_file)
        client_id[0] = popup.show()
        from weather_data_from_metno import update_weather_data, make_data_file

    make_data_file()

    print(client_id[0])
    print('Done')