# -*- coding: utf-8 -*-
"""
Created on Fri May 18 11:50:35 2018

@author: frkl
"""
import matplotlib
import os
import sys
import tkinter as tk
import logging

sys.path.append(os.path.realpath(os.path.join(os.getcwd(), '../../prog')))
from ffr_gui import App

matplotlib.use("Qt5Agg")

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logging.getLogger('matplotlib.font_manager').disabled = True

    project_name = 'Greenmove'

    flux_units = {'N2O': {'name': 'N2O_N_mug_m2h', 'factor': 2 * 14 * 1e6 * 3600},
                  'CO2': {'name': 'CO2_C_mug_m2h', 'factor': 12 * 1e6 * 3600}}

    specific_options = {
        "ALL": {
            'interval': 100,
            'start': 0,
            'stop': 180,
            'crit': 'steepest',
            'co2_guides': True,
            'correct_negatives': False,
            'exclude': False
        }
    }
    treatment_legend = {
        1: {"name": "Barley+ryegrass Moved", "treatment": "2B", "plots": (1, 6, 7, 12)},
        2: {"name": "Barley+ryegrass Control", "treatment": "2A", "plots": (2, 5, 8, 11)},
        3: {"name": "Barley+ryegrass Mov+Min", "treatment": "2C", "plots": (3, 4, 9, 10)},
        4: {"name": "Barley Moved", "treatment": "1B", "plots": (13, 18, 19, 24)},
        5: {"name": "Barley Control", "treatment": "1A", "plots": (14, 17, 20, 23)},
        6: {"name": "Barley Mov+Min", "treatment": "1C", "plots": (15, 16, 21, 22)},
        7: {"name": "Cover crops Moved", "treatment": "3B", "plots": (25, 30, 31, 36)},
        8: {"name": "Cover crops Control", "treatment": "3A", "plots": (26, 29, 32, 35)},
        9: {"name": "Cover crops Mov+Min", "treatment": "3C", "plots": (27, 28, 33, 34)},
        10: {"name": "Ley Moved", "treatment": "4B", "plots": (37, 42, 43, 48)},
        11: {"name": "Ley Control", "treatment": "4A", "plots": (38, 41, 44, 47)},
        12: {"name": "Ley Mov+Min", "treatment": "4C", "plots": (39, 40, 45, 46)}

    }

    persistent_column_selection = ['date', 'CO2_C_mug_m2h', 'N2O_N_mug_m2h', "type",
                                   'treatment', 'Tc', 'precip', "nr", 'treatment_name',"excluded"]

    non_uncheckable_columns = ['date', 'treatment', "nr", 'N2O_N_mug_m2h']

    root = tk.Tk()
    app = App(root, flux_units, specific_options, treatment_legend, persistent_column_selection, project_name,
              non_uncheckable_columns)
    root.mainloop()
