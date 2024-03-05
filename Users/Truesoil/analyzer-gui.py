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

    project_name = 'Truesoil'

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
        1: {"name": "Regntak", "treatment": "R", "plots": (1, 3, 5, 7, 9, 11, 13, 15)},
        2: {"name": "Kontroll (regntak)", "treatment": "K", "plots": (2, 4, 6, 8, 10, 12, 14, 16)},
        3: {"name": "Kontroll (overfor)", "treatment": "O",
            "plots": (17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32)}
    }

    persistent_column_selection = ['date', 'CO2_C_mug_m2h', 'N2O_N_mug_m2h', "type",
                                   'treatment', 'Tc', 'precip', "nr", 'treatment_name']

    non_uncheckable_columns = ['date', 'treatment', "nr", 'N2O_N_mug_m2h']

    root = tk.Tk()
    app = App(root, flux_units, specific_options, treatment_legend, persistent_column_selection, project_name,
              non_uncheckable_columns)
    root.mainloop()
