# -*- coding: utf-8 -*-
"""
Created on Fri May 18 11:50:35 2018

@author: frkl
"""
import os,sys,matplotlib
import tkinter as tk
matplotlib.use("Qt5Agg")
import logging
sys.path.append(os.path.realpath(os.path.join(os.getcwd(), '../../prog')))
from ffr_gui import App

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logging.getLogger('matplotlib.font_manager').disabled = True

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

    treatment_legend = { 1: {'name': 'Control N1', 'plots': [9, 19, 30]},
                         2: {'name': 'Control N2', 'plots': [2, 18, 27]},
                         3: {'name': 'Perenial ryegrass N1', 'plots': [12, 23, 25]},
                         4: {'name': 'Perenial ryegrass N2', 'plots': [5, 15, 28]},
                         5: {'name': 'Italian ryegrass N1', 'plots': [10, 17, 29]},
                         6: {'name': 'Italian ryegrass N2', 'plots': [1, 22, 32]},
                         7: {'name': 'Summer vetch N1', 'plots': [4, 20, 36]},
                         8: {'name': 'Winter vetch N1', 'plots': [11, 21, 35]},
                         9: {'name': 'Oilseed radish N1', 'plots': [6, 24, 34]},
                         10: {'name': 'Oilseed radish N2', 'plots': [8, 16, 26]},
                         11: {'name': 'Phaselia N2', 'plots': [7, 14, 31]},
                         12: {'name': 'Grønn bro N1', 'plots': [3, 13, 33]}}

    persistent_column_selection = ['date', 'CO2_slope', 'CO2_rsq', 'N2O_slope', 'N2O_rsq',
                                   'treatment', 'Tc', 'precip', 'treatment_name']

    root = tk.Tk()
    app = App(root,flux_units,specific_options,treatment_legend,persistent_column_selection)
    root.mainloop()
