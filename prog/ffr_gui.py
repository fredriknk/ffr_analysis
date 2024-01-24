import tkinter as tk
from tkinter import ttk
import pickle
import pandas as pd
import sys
import os
import pickle
import numpy as np
import pandas as pd
from os import walk, chdir, getcwd, stat
import tkinter as TK
from tkinter import filedialog
from tkinter import messagebox
import matplotlib


from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
from time import time
from datetime import datetime
import matplotlib.pyplot as plt
import copy
import datetime as DT
from collections import defaultdict
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
from matplotlib.text import Text
from matplotlib.widgets import Slider
from scipy.stats import gmean
from scipy.stats import gstd
from yaml import safe_load


from regression import *
import weather_data
import find_regressions
import bisect_find
import utils
import resdir
import csv
import read_regression_exception_list
import flux_calculations
from pandas.api.types import is_numeric_dtype, is_datetime64_any_dtype

def make_dataset():
    filename = "output/capture_slopes.xls"  # filename for raw output
    filename_manual = "output/capture_slopes_manual.xls"  # filename for raw output
    df_b = pd.read_excel(filename)  # import excel docuument
    df_m = pd.read_excel(filename_manual)
    df_b = pd.concat([df_b, df_m])
    df_b.index = df_b["Unnamed: 0"]

    df_b['date'] = pd.to_datetime(df_b['date'])  # make date column to datetime objects
    df_b = df_b.sort_values(by=['date'])  # sort all entries by date
    df = df_b

    df_w = make_df_weather(df_b['date'].min(), df_b['date'].max())
    #df_w[["HOURS_SINCE_THAW", "HOURS_SINCE_FREEZE", "TEMPC_GROUND"]].plot()
    df_b = df_b.sort_values(by=['date'])  # sort all entries by date

    return pd.merge_asof(df_b, df_w, left_on='date', right_index=True, direction="nearest")

def freezethaw(df):
    #FREEZE
    a = df[df.HOURS_SINCE_FREEZE >= 0]
    plt.scatter(a.HOURS_SINCE_FREEZE,a.N2O_N_mug_m2h.values)

    arr = df.groupby(df.HOURS_SINCE_FREEZE).N2O_N_mug_m2h.apply(list)
    ax = plt.subplot()
    ax.set_yscale('log')
    ax.boxplot(arr)
    plt.show()

    #THAW
    b = df[df.HOURS_SINCE_THAW >= 0]
    plt.scatter(b.HOURS_SINCE_THAW,b.N2O_N_mug_m2h.values)

    arr = df.groupby(df.HOURS_SINCE_THAW).N2O_N_mug_m2h.apply(list)
    ax = plt.subplot()
    ax.set_title("Hourse Since Freeze")
    ax.set_yscale('log')
    ax.boxplot(arr)
    plt.show()

    arr =df.groupby(df.TEMPC_GROUND.round()).N2O_N_mug_m2h.apply(list)#
    x = df.TEMPC_GROUND
    y = df.N2O_N_mug_m2h
    ax = plt.subplot()
    ax.set_title("TEMP CORR")
    ax.scatter(x,y)
    plt.show()

def zeropass(df_, type="rising"):
    a = df_.values[0]
    b = df_.values[-1]
    flag = True
    if type == "rising":
        if (a < 0) and (b >= 0):
            flag = False
        elif (a < 0) and (b <= 0):
            flag = False
    elif type == "falling":
        if (a > 0) and (b <= 0):
            flag = False
        elif (a > 0) and (b >= 0):
            flag = False

    return flag

def make_df_weather(date_min,date_max):
    df_weather = make_logger_data()
    df_weather = df_weather[date_min:date_max]
    df_w = df_weather

    param = "ECC_GROUND"
    hours = 12
    df_w[param + "_ROLLINGAVG"] = df_w[param].rolling(hours, min_periods=1).mean()

    param = 'TEMPC_GROUND'
    df_w[param + "_ROLLINGAVG"] = df_w[param].rolling(hours, min_periods=1).mean()

    param = "VWC_GROUND"
    df_w[param + "_ROLLINGAVG"] = df_w[param].rolling(hours, min_periods=1).mean()
    # print(self.fileSave)

    param = 'sum(precipitation_amount PT1H)'
    hours = 24
    df_w["precip" + "_ROLLINGSUM_" + str(hours) + "_H"] = df_w[param].rolling(hours, min_periods=1).sum()
    # print(self.fileSave)

    df_w["TEMPC_GROUND_FFILL"] = df_w.TEMPC_GROUND.fillna(method="ffill")
    df_rolling = df_w.rolling(2, min_periods=1)
    df_w["RISING_TEMP_PASS"] = df_rolling.TEMPC_GROUND_FFILL.apply(lambda x: zeropass(x, "rising")).astype("bool")
    df_w["FALLING_TEMP_PASS"] = df_rolling.TEMPC_GROUND_FFILL.apply(lambda x: zeropass(x, "falling")).astype("bool")
    df_w["RISING_TEMP_PASS"].iloc[0] = False
    df_w["FALLING_TEMP_PASS"].iloc[0] = False
    max_hours = 24*10

    a = df_w["RISING_TEMP_PASS"]
    param = "HOURS_SINCE_THAW"
    df_w[param] = (a.cumsum() - a.cumsum().where(~a).ffill().fillna(0).astype(int))  # .shift(-1)
    df_w.loc[(df_w[param] == df_w[param].shift(-1)), param] = None
    df_w.loc[(df_w[param] > max_hours), param] = None
    df_w[param].iloc[0] = None
    df_w[param].iloc[-1] = None

    a = df_w["FALLING_TEMP_PASS"]
    param = "HOURS_SINCE_FREEZE"
    df_w[param] = (a.cumsum() - a.cumsum().where(~a).ffill().fillna(0).astype(int))  # .shift(-1)
    df_w.loc[(df_w[param] == df_w[param].shift(-1)), param] = None
    df_w.loc[(df_w[param] > max_hours), param] = None
    #df_w[["HOURS_SINCE_THAW", "HOURS_SINCE_FREEZE", "TEMPC_GROUND"]].plot()
    df_w[param].iloc[0] = None
    df_w[param].iloc[-1] = None

    return df_w

def trendline(data, order=1):
    hours = len(data)
    coeffs = np.polyfit(range(hours), list(data), order)
    slope = coeffs[-2]
    return float(slope)


def read_yaml(file_path = "config.yml"):
    with open(file_path, "r", encoding='utf-8') as f:
        return safe_load(f)

def make_logger_data():
    PATHS = read_yaml()["PATHS"]

    df_weather = pd.DataFrame.from_dict(dict(weather_data.weather_data_from_metno.get_stored_data())).T
    df_weather.index = pd.to_datetime(df_weather.index, unit='s')

    if "LOGGER_PATH" in PATHS:
        loggerfile = PATHS["LOGGER_PATH"]
        df_ = pd.read_excel(loggerfile, skiprows=2)
        df = df_[['Measurement Time']]
        keys = df_.keys()
        VWC = keys[[i for i, x in enumerate(keys) if "VWC" in x]]
        TEMP = keys[[i for i, x in enumerate(keys) if "°C Temp" in x]]
        ECC = keys[[i for i, x in enumerate(keys) if "mS/cm EC" in x]]

        df_["VWC_GROUND"] = df_[VWC].mean(axis=1)
        df_["TEMPC_GROUND"] = df_[TEMP].mean(axis=1)
        df_["ECC_GROUND"] = df_[ECC].mean(axis=1)

        df_ground = df_[["Measurement Time", "VWC_GROUND", "TEMPC_GROUND","ECC_GROUND"]]

        df_ground.set_index("Measurement Time",inplace=True)


        return pd.concat([df_weather,df_ground], axis=1, join='inner')

    else:
        print("NO LOGGER FILEPATH")
        return df_weather

def slopeFromPoints(reg):
    return [[reg.start, reg.stop], [reg.intercept + reg.start * reg.slope, reg.intercept + reg.stop * reg.slope]]


def datecheck(newdate="2022-01-12 12:03:30", dateFormatList=None):
    """
    Parses a date towards multiple dateformats and stops trying after first success. outputs a datetime object.
    the default date format list is:
    dateFormatList = ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y.%m.%d %H:%M:%S', '%Y.%m.%d', '%y.%m.%d', '%Y-%m-%d',
                      '%Y-%m-%d', '%Y%m%d', '%Y%m']
    """
    if dateFormatList is None:
        dateFormatList = {"%Y-%m-%dT%H:%M:%S",
                          "%Y-%m-%d %H:%M:%S",
                          "%Y.%m.%d %H:%M:%S",
                          "%Y.%m.%d",
                          "%y.%m.%d",
                          "%Y-%m-%d",
                          "%Y-%m-%d",
                          "%Y%m%d",
                          "%Y%m"
                          }

    date = None

    for dateFormat in dateFormatList:
        try:
            date = datetime.strptime(newdate, dateFormat)
            break
        except ValueError:
            pass

    if date == None:
        print("""Parsing error, please use one of theese formats: ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y.%m.%d %H:%M:%S', '%Y.%m.%d', '%y.%m.%d', '%Y-%m-%d',
                      '%Y-%m-%d', '%Y%m%d', '%Y%m'""")
        date = datetime.now()

    return date



class popupWindow(object):
    def __init__(self, master):
        px = 5
        py = 5

        top = self.top = TK.Toplevel(master)

        self.text1 = TK.Label(top, text="Goto #")
        self.text1.grid(row=0, column=0, padx=px, pady=py)
        # self.text1.pack()

        self.gotoNo = TK.Entry(top)
        self.gotoNo.grid(row=0, column=2, padx=px, pady=py)
        # self.entry1.pack()

        self.text2 = TK.Label(top, text="Goto YYYY-MM-DD HH:MM:SS")
        self.text2.grid(row=1, column=0, padx=px, pady=py)
        # self.text2.pack()

        self.datetext = TK.Entry(top)
        self.datetext.grid(row=1, column=2, padx=px, pady=py)
        # self.entry2.pack()

        self.button = TK.Button(top, text='Ok', command=self.cleanup)
        self.button.grid(row=2, column=0, padx=px, pady=py)

        self.cancel = TK.Button(top, text='Last Entry', command=self.cleanup)
        self.cancel.grid(row=2, column=1, padx=px, pady=py)

        self.cancel = TK.Button(top, text='Cancel', command=self.cancel)
        self.cancel.grid(row=2, column=2, padx=px, pady=py)


        # self.button.pack()

    def cancel(self):
        self.cancel_ = True
        self.top.destroy()

    def cleanup(self):
        self.cancel = False
        self.value = self.gotoNo.get()
        self.date = self.datetext.get()
        self.top.destroy()


class SpecificOptionsPopup:
    def __init__(self, master, specific_options, on_select_callback):
        self.top = tk.Toplevel(master)
        self.specific_options = specific_options
        self.on_select_callback = on_select_callback
        self.create_widgets()

    def create_widgets(self):
        # Search bar
        self.search_var =tk.StringVar()
        self.search_var.trace("w", lambda name, index, mode, sv=self.search_var: self.update_table())
        tk.Entry(self.top, textvariable=self.search_var).pack()

        # Determine if specific_options is a DataFrame or dict and set up columns
        if isinstance(self.specific_options, pd.DataFrame):
            columns = tuple(self.specific_options.columns)
        else:  # It's a dict
            columns = ('Key',) + tuple(next(iter(self.specific_options.values())).keys())

        # Treeview
        self.tree = ttk.Treeview(self.top, columns=columns, show='headings')
        for col in self.tree['columns']:
            self.tree.heading(col, text=col, command=lambda _col=col: self.treeview_sort_column(_col, False))
            self.tree.column(col, anchor=tk.W)

        # Scrollbar
        scrollbar = ttk.Scrollbar(self.top, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side='right', fill='y')

        self.tree.pack(expand=True, fill='both')
        self.update_table()

        self.tree.bind("<<TreeviewSelect>>", self.on_tree_select)

    def update_table(self):
        search_term = self.search_var.get().lower()
        for i in self.tree.get_children():
            self.tree.delete(i)

        if isinstance(self.specific_options, pd.DataFrame):
            self.update_table_from_dataframe(search_term)
        else:
            self.update_table_from_dict(search_term)

    def update_table_from_dict(self, search_term):
        for key, values in self.specific_options.items():
            if search_term in key.lower():
                row_data = [values[col] for col in self.tree['columns'][1:]]  # Skip the first 'Key' column
                self.tree.insert('',tk.END, values=[key] + row_data)

    def update_table_from_dataframe(self, search_term):
        for index, row in self.specific_options.iterrows():
            if search_term in str(row['Key']).lower():
                row_data = [row[col] for col in self.tree['columns']]
                self.tree.insert('',tk.END, values=row_data)

    def on_tree_select(self, event):
        selected_item = self.tree.item(self.tree.selection())
        if selected_item:
            selected_key = selected_item['values'][0]
            self.on_select_callback(selected_key)

    def treeview_sort_column(self, col, reverse):
        l = [(self.tree.set(k, col), k) for k in self.tree.get_children('')]
        l.sort(reverse=reverse)
        for index, (val, k) in enumerate(l):
            self.tree.move(k, '', index)
        self.tree.heading(col, command=lambda: self.treeview_sort_column(col, not reverse))

class Dataframe_Filter_Popup:
    def __init__(self, master, data_frame, on_select_callback):
        self.top = tk.Toplevel(master)
        self.original_df = data_frame.copy()  # Store the original DataFrame
        self.filtered_df = data_frame  # This will hold the filtered DataFrame
        self.on_select_callback = on_select_callback
        self.filter_values = {}
        self.create_widgets()

    def create_widgets(self):
        self.search_var = tk.StringVar()
        self.search_var.trace("w", lambda name, index, mode, sv=self.search_var: self.update_table())
        tk.Entry(self.top, textvariable=self.search_var).pack()
        # Checkbox for column filtering
        self.column_filter_var = tk.BooleanVar()
        tk.Checkbutton(self.top, text="Filter Columns", variable=self.column_filter_var).pack()

        # Export button
        self.export_button = tk.Button(self.top, text="Export Data", command=self.export_data)
        self.export_button.pack()

        first_row = self.filtered_df.iloc[0]

        # Create a toggle button for showing/hiding filters
        self.toggle_filters_button = tk.Button(self.top, text="Show Filters", command=self.toggle_filters)
        self.toggle_filters_button.pack()

        # Create a frame for filters, initially hidden
        self.filters_frame = tk.Frame(self.top)
        self.filters_frame.pack(fill=tk.X, expand=False)
        self.filters_visible = False  # Initially, filters are not visible

        self.apply_filters_button = tk.Button(self.top, text="Apply Filters", command=self.update_table)
        self.apply_filters_button.pack()

        row = 0
        for col in self.filtered_df.columns:
            if pd.api.types.is_datetime64_any_dtype(self.filtered_df[col]):
                self.add_date_range_entries(col, row)
                row += 1
            elif pd.api.types.is_numeric_dtype(self.filtered_df[col]):
                self.add_min_max_entries(col, row)
                row += 1

        # Treeview setup
        # Convert column names to string and remove any special characters if needed
        column_names = ['Nr'] + list(map(str, self.filtered_df.columns))
        # Treeview setup
        self.tree = ttk.Treeview(self.top, columns=column_names, show='headings')

        # Set up the treeview style for gridlines and alternating row colors
        style = ttk.Style()
        style.configure("Treeview", background="white", foreground="black", rowheight=25)
        style.configure("Treeview.Heading", font=('Calibri', 10, 'bold'))
        style.map('Treeview', background=[('selected', 'blue')])
        style.layout("Treeview", [('Treeview.treearea', {'sticky': 'nswe'})])  # Remove borders
        # Alternating row tags
        self.tree.tag_configure('oddrow', background='lightgrey')
        self.tree.tag_configure('evenrow', background='white')

        # Set up the headings and columns
        for col_name in column_names:
            self.tree.heading(col_name, text=col_name)
            self.tree.column(col_name, anchor=tk.W)

        scrollbar = ttk.Scrollbar(self.top, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side='right', fill='y')
        self.tree.pack(fill=tk.BOTH, expand=True)

        self.tree.bind("<<TreeviewSelect>>", self.on_tree_select)
        self.update_table()

    def export_data(self):
        # Check if column filter is selected
        if self.column_filter_var.get():
            # Apply column filtering logic here (if needed)
            # For example, you can filter out columns based on some criteria
            filtered_columns = [col for col in self.filtered_df.columns if some_condition]
            export_df = self.filtered_df[filtered_columns]
        else:
            export_df = self.filtered_df

        # Call the callback function with the filtered DataFrame
        self.on_select_callback(export_df)
    def toggle_filters(self):
        # Toggle the visibility of the filters frame
        if self.filters_visible:
            self.filters_frame.pack_forget()
            self.toggle_filters_button.config(text="Show Filters")
        else:
            self.filters_frame.pack(fill=tk.X, expand=False)
            self.toggle_filters_button.config(text="Hide Filters")
        self.filters_visible = not self.filters_visible
    def add_min_max_entries(self, col, row):
        tk.Label(self.filters_frame, text=f"{col} Min:").grid(row=row, column=0)
        min_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=min_var).grid(row=row, column=1)

        tk.Label(self.filters_frame, text=f"{col} Max:").grid(row=row, column=2)
        max_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=max_var).grid(row=row, column=3)

        self.filter_values[col] = {'min': min_var, 'max': max_var}

    def add_date_range_entries(self, col, row):
        tk.Label(self.filters_frame, text=f"{col} Start:").grid(row=row, column=0)
        start_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=start_var).grid(row=row, column=1)

        tk.Label(self.filters_frame, text=f"{col} End:").grid(row=row, column=2)
        end_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=end_var).grid(row=row, column=3)

        self.filter_values[col] = {'start': start_var, 'end': end_var}

    def update_table(self):
        # Get the search term from the search_var StringVar
        minval = 0.01
        search_term = self.search_var.get().lower()

        filtered_df = self.apply_filters()
        for i in self.tree.get_children():
            self.tree.delete(i)
        row_color_counter = 0
        # Use the first column's name as the key
        first_column_name = self.filtered_df.columns[0]

        for index, row in filtered_df.iterrows():
            # Check if the search term is in the first column's value
            if search_term in str(row[first_column_name]).lower():
                # Format numbers based on their value
                row_data = [index] + [
                    f"{val:.1f}" if isinstance(val, float) and abs(val) == 0 else
                    f"{val:.0f}" if isinstance(val, int ) else
                    f"{val:.2e}" if isinstance(val, (int, float)) and abs(val) < minval else
                    f"{val:.2f}" if isinstance(val, (int, float)) else val
                    for val in row
                ]
                color_tag = 'evenrow' if row_color_counter % 2 == 0 else 'oddrow'
                self.tree.insert('', tk.END, values=row_data, tags=(color_tag,))
                row_color_counter += 1  # Increment the counter

        # Alternate row color configuration (if not done already in create_widgets)
        self.tree.tag_configure('oddrow', background='lightgrey')
        self.tree.tag_configure('evenrow', background='white')
    def apply_filters(self):
        df = self.filtered_df.copy()
        for col, filters in self.filter_values.items():
            if 'min' in filters and filters['min'].get():
                df = df[df[col] >= float(filters['min'].get())]
            if 'max' in filters and filters['max'].get():
                df = df[df[col] <= float(filters['max'].get())]
            if 'start' in filters and filters['start'].get():
                df = df[df[col] >= pd.to_datetime(filters['start'].get())]
            if 'end' in filters and filters['end'].get():
                df = df[df[col] <= pd.to_datetime(filters['end'].get())]
        return df

    def on_tree_select(self, event):
        selected_item = self.tree.item(self.tree.selection())
        if selected_item:
            print(selected_item)  # This will now include the DataFrame index
            selected_index = selected_item['values'][0]  # This is the DataFrame index
            self.on_select_callback(selected_index)

class ColumnSelectionPopup:
    def __init__(self, master, all_columns, on_submit_callback, preselected_columns=None):
        self.top = tk.Toplevel(master)
        self.all_columns = all_columns
        self.preselected_columns = preselected_columns if preselected_columns is not None else []
        self.on_submit_callback = on_submit_callback
        self.selected_columns = []
        self.create_widgets()
    def create_widgets(self):
        # Determine grid layout dimensions
        num_cols = 3  # You can adjust the number of columns as needed
        num_rows = (len(self.all_columns) + num_cols - 1) // num_cols

        for index, col in enumerate(self.all_columns):
            is_checked = col in self.preselected_columns
            var = tk.BooleanVar(value=is_checked)
            chk = tk.Checkbutton(self.top, text=col, variable=var)
            # Arrange checkboxes in a grid
            chk.grid(row=index // num_cols, column=index % num_cols, sticky='w')
            self.selected_columns.append((col, var))

        # Place the submit button at the bottom of the grid
        submit_button = tk.Button(self.top, text="Submit", command=self.submit)
        submit_button.grid(row=num_rows, column=0, columnspan=num_cols)

    def submit(self):
        selected = [col for col, var in self.selected_columns if var.get()]
        self.on_submit_callback(selected)
        self.top.destroy()

class App:

    def __init__(self, master,flux_units,specific_options,treatment_legend):
        # Create the GUI container
        super().__init__()
        frame = tk.Frame(master, width=2000, height=2000)
        self.master = master
        self.master.title("FFR Analyzer")
        self.initializeDF()
        self.flux_units = flux_units
        self.specific_options= specific_options
        self.treatment_legend = treatment_legend
        self.maxf = len(self.df)
        self.nr = 0  # measurement number
        self.fname = self.df.iloc[self.nr].filename
        self.xint = 100  # regression window
        self.cutoff = 0.05  # cutoff percentage
        self.method = tk.StringVar(self.master)  # Variable for radiobox regression method
        self.method.set(self.options["crit"])  # Set default to Mse
        self.CO2_guide = tk.IntVar()
        self.exclude = tk.IntVar()
        self.persistent_column_selection = ['date', 'CO2_slope', 'CO2_rsq', 'N2O_slope', 'N2O_rsq', 'treatment', 'Tc', 'precip']

        row_disp = 0
        ##Buttons for scrolling left rigth
        self.button_left = tk.Button(frame, text="< Prev",
                                     command=self.decrease)
        # Placement of the button with padding around edges
        self.button_left.grid(row=row_disp, column=0, padx=5, pady=5)  # pack( padx=5, pady=5)

        self.button_right = tk.Button(frame, text="GoTo#",
                                      command=self.goto)
        self.button_right.grid(row=row_disp, column=1, padx=5, pady=5)  # .pack( padx=5, pady=5)

        self.button_right = tk.Button(frame, text="Next >",
                                      command=self.increase)
        self.button_right.grid(row=row_disp, column=2, padx=5, pady=5)  # .pack( padx=5, pady=5)

        self.Outs = {}

        graph_unit = " (ppm)"

        row_disp += 1

        label = "CO2"
        name = "CO2 Header"

        self.Outs[name + "label"] = tk.Label(frame, text=label)
        self.Outs[name + "label"].grid(row=row_disp, column=1, padx=5, pady=5)

        label = "N20"
        name = "N20 Header"

        self.Outs[name + "label"] = tk.Label(frame, text=label)
        self.Outs[name + "label"].grid(row=row_disp, column=2, padx=5, pady=5)

        row_disp += 1
        name = "CO2_MUG"
        label = "µG/m²/h"
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "N2O_MUG"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "CO2_SLOPE"
        label = "Slope (ppm/s)"#+graph_unit
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "N2O_SLOPE"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "mse_CO2"
        label = "MSE"+graph_unit
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "mse_N2O"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "rsq_CO2"
        label = "r² line fit"
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "rsq_N2O"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "diff_CO2"
        label = "diff" +graph_unit
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "diff_N2O"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "SampleNo"
        label = "graph #"
        self.MakeTextbox(name, label, row_disp, frame, 1)

        row_disp += 1
        name = "airTemp"
        label = "Air Temp"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "side_box"
        label = "Side"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "precip"
        label = "Precip"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "Plot NR"
        label = "Plot NR"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "Treatment NO"
        label = "Treatment NO"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "Treatment Name"
        label = "Treatment Name"
        self.MakeTextbox(name, label, row_disp, frame,width=25, cspan=2)

        row_disp += 1
        self.WindowLabel = tk.Label(frame, text="Regr Window")
        self.WindowLabel.grid(row=row_disp, column=0, padx=5, pady=5)
        # tkinter needs special variables it seems like
        self.var = tk.StringVar(self.master)
        # Init the scrollbox variable to 100 for regression window
        self.var.set(self.options["interval"])
        # initialize scrollbox
        self.XINT = tk.Spinbox(frame, from_=3, to=10000, width=5, increment=1, textvariable=self.var)
        # placement of scrollbox
        self.XINT.grid(row=row_disp, column=1, padx=5, pady=5)

        # Make radiobuttons for
        row_disp += 1
        self.R1 = tk.Radiobutton(frame, text="MSE", variable=self.method, value="mse", command=self.update)
        #        options = ("steepest","mse")
        #        self.R1 = tk.OptionMenu(frame, self.method, *options, command = self.update)
        self.R1.grid(row=row_disp, column=0, padx=5, pady=5)  # Radiobutton for reg method
        #
        self.R2 = tk.Radiobutton(frame, text="Steep", variable=self.method, value='steepest', command=self.update)
        self.R2.grid(row=row_disp, column=1, padx=5, pady=5)  # Radio button for reg method

        row_disp += 1
        self.C1 = tk.Checkbutton(frame, text='CO2 Guide', variable=self.CO2_guide, onvalue=1, offvalue=0, command=self.update)
        self.C1.grid(row=row_disp, column=0, padx=5, pady=5)  # Radio button for reg method
        self.C2 = tk.Checkbutton(frame, text='Exclude', variable=self.exclude, onvalue=1, offvalue=0, command=self.update)
        self.C2.grid(row=row_disp, column=1, padx=5, pady=5)  # Radio button for reg method

        row_disp += 2
        self.update_button = tk.Button(frame, text="Update",
                                       command=self.update)  # Update the graph
        self.update_button.grid(row=row_disp, column=0)

        self.reset_button = tk.Button(frame, text="Reset Params",
                                      command=self.reset)  # Update the graph
        self.reset_button.grid(row=row_disp, column=2)
        row_disp += 1

        self.set_param = tk.Button(frame, text="Set Default",
                                   command=self.setDefault)  # Update the graph
        self.set_param.grid(row=row_disp, column=2, pady=5)

        row_disp += 1
        self.SpecificOptionsButton = tk.Button(frame, text="View Dataframe", command=self.viewDataFrame)
        self.SpecificOptionsButton.grid(row=row_disp, column=0, pady=40)

        self.SpecificOptionsButton = tk.Button(frame, text="View Specific Options",command=self.viewSpecificOptions)
        self.SpecificOptionsButton.grid(row=row_disp, column=1, pady=40)

        self.save = tk.Button(frame, text="Show Cumsum Plot",
                              command=self.saveGraph)
        self.save.grid(row=row_disp, column=2, pady=40)

        row_disp += 1


        self.save = tk.Button(frame, text="Export To Excel",
                              command=self.toExcel)  # Update the graph
        self.save.grid(row=row_disp, column=0, pady=40)

        self.save = tk.Button(frame, text="Export To Excel Noavg",
                              command=self.toExcel_noavg)  # Update the graph
        self.save.grid(row=row_disp, column=1, pady=40)

        self.save = tk.Button(frame, text="Drop Measurement",
                              command=self.dropMeasurement)  # Update the graph
        self.save.grid(row=row_disp, column=2, pady=40)

        #
        self.Outs["CO2_SLOPE"].configure(state="disabled")

        self.fig = Figure(figsize=(15, 10), dpi=80)  # Set the size of plot
        plt.style.use('ggplot')
        self.ax = self.fig.add_subplot(121)
        self.ax1 = self.fig.add_subplot(122)
        # self.ax2 = self.fig.add_subplot(424)
        # self.ax3 = self.fig.add_subplot(426)
        # self.ax4 = self.fig.add_subplot(428)
        self.ax.set_title("CO2")
        self.ax.set_xlabel("Time (s)")
        self.ax.set_ylabel("CO2 (ppm)")
        self.fig.autofmt_xdate()  # Dont know what this does

        self.CO2line1, = self.ax.plot([1, 2], [1, 2], linewidth=1, color="tab:blue",
                                     alpha=0.5)  # Inititalise measurement graph
        self.CO2line2, = self.ax.plot([1, 2], [1, 2], marker='o', linestyle='dashed', linewidth=2, color="tab:green",
                                      alpha=0.7)
        self.CO2line3, = self.ax.plot([1, 2], [1, 2], linewidth=3, color="tab:orange")  # Inititalize regression graph
        self.CO2start, = self.ax.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)
        self.CO2stop, = self.ax.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)


        self.N2Oline1, = self.ax1.plot([1, 2], [1, 2], linewidth=1, color="tab:blue", alpha=0.5)
        self.N2Oline2, = self.ax1.plot([1, 2], [1, 2], marker='o', linestyle='dashed', linewidth=2,
                                           color="tab:green", alpha=0.7)  # Inititalize regression graph
        self.N2Oline3, = self.ax1.plot([1, 2], [1, 2], linewidth=3,
                                           color="tab:orange")  # Inititalize regression graph
        self.N2Ostart, = self.ax1.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)
        self.N2Ostop, = self.ax1.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)

        self.ax1.set_title("N2O")
        self.ax1.set_title("N20")
        self.ax1.set_ylabel("N2O (ppm)")
        self.ax1.set_xlabel("Time (S)")

        self.fig.subplots_adjust(left=0.05, right=0.95, top=0.9, bottom=0.06)
        self.canvas = FigureCanvasTkAgg(self.fig, master=master, )  # Make the canvas
        self.canvas.draw()  # show()#show the canvesRemoved due to breaking update
        self.canvas.get_tk_widget().grid(row=0, column=3, rowspan=9)  # set graph position

        sliderLength = 1000
        self._job = None
        self.sliderMin = tk.Scale(master, from_=0, to=180, length=sliderLength, orient=tk.HORIZONTAL)
        self.sliderMin.bind("<ButtonRelease-1>", self.updateValue)
        self.sliderMin.set(self.options["start"])
        self.sliderMin.grid(row=10, column=3)

        self.sliderMax = tk.Scale(master, from_=0, to=180, length=sliderLength, orient=tk.HORIZONTAL)
        self.sliderMax.bind("<ButtonRelease-1>", self.updateValue)
        self.sliderMax.set(self.options["stop"])
        self.sliderMax.grid(row=11, column=3)

        self.getParams()
        self.update()

        frame.grid(row=0, column=0)
        #
        # self.canvas.pack()
        # self.canvas.bind("<Left>", self.decrease)
        # self.canvas.bind("<Right>", self.increase)

    def initializeDF(self):
        fixpath = utils.ensure_absolute_path
        self.outpath = fixpath('output/')
        detailed_output_path = fixpath('output/detailed_regression_output_unsorted')
        find_regressions.make_detailed_output_folders(detailed_output_path)
        self.specific_options_filename = fixpath('specific_options.pickle')
        print(self.specific_options_filename)
        slopes_filename = fixpath("output/capture_slopes.txt")

        if  ".pickle" in self.specific_options_filename:
            try:
                self.specific_options = read_regression_exception_list.open_pickle_file(self.specific_options_filename)
                print("Loaded specific options from pickle file")
            except:
                self.specific_options = specific_options
                read_regression_exception_list.save_pickle_file(self.specific_options_filename, specific_options)
                print("Saved default specific options to new pickle file")
        else:
            self.specific_options = read_regression_exception_list.parse_xls_file(self.specific_options_filename)

        #Adding exclude to all entries for backwards compatibility
        for entry in self.specific_options:
            if 'exclude' not in self.specific_options[entry]:
                self.specific_options[entry]['exclude'] = False

        self.options = copy.deepcopy(self.specific_options["ALL"])

        self.options_bcp = copy.deepcopy(self.options)

        self.save_options = {'show_images': False,
                             'save_images': False,
                             'save_detailed_excel': False,
                             'sort_detailed_by_experiment': False
                             }

        try:
            resdir.raw_data_path = read_yaml()["PATHS"]['RAWDATA']
            self.raw_data = read_yaml()["PATHS"]['RAWDATA']
            self.manual =  read_yaml()["PATHS"]["MANUAL"]
        except FileNotFoundError:
            print(resdir.raw_data_path + ' not found')
            resdir.raw_data_path = fixpath('raw_data')

        df_path = "output/capture_RegressionOutput.xls"
        self.file_path = df_path

        self.df = pd.read_excel(df_path, index_col=0)

        self.df.date = pd.to_datetime(self.df.date, format="%Y%m%d-%H%M%S")

        self.regr = find_regressions.Regressor(slopes_filename, self.options, self.save_options,
                                               self.specific_options_filename, detailed_output_path)



    def updateValue(self, event):
        self.update()

    def saveGraph(self):
        # self.fileSave = tk.filedialog.asksaveasfilename(initialdir=currDir, initialfile=f[self.nr], title="Save Graph",
        #                                                 filetypes=(("PNG", ".png"), ("all files", "*.*")))
        # if self.fileSave == "":
        #     return
        # self.fig.savefig(self.fileSave + ".png")
        self.allplot()

    def menubar(self, root):
        menubar = tk.Menu(root)
        pageMenu = tk.Menu(menubar)
        pageMenu.add_command(label="PageOne")
        menubar.add_cascade(label="PageOne", menu=pageMenu)
        return menubar

    def toExcel(self):
        self.fileSave = tk.filedialog.asksaveasfilename(initialdir=self.outpath, title="Save file",
                                                        filetypes=(("Excel File", ".xlsx"), ("all files", "*.*")))

        if self.fileSave == "":
            return

        filename = "output/capture_slopes.xls"  # filename for raw output
        filename_manual = self.manual  # filename for raw output
        df_b = pd.read_excel(filename)  # import excel docuument
        df_m = pd.read_excel(filename_manual)
        df_b = pd.concat([df_b, df_m])
        df_b.index = df_b["Unnamed: 0"]

        df_b['date'] = pd.to_datetime(df_b['date'])  # make date column to datetime objects
        df_b = df_b.sort_values(by=['date'])  # sort all entries by date
        df = df_b
        df_w = make_df_weather(df_b['date'].min(),df_b['date'].max())

        self.fileSave = self.fileSave.replace(".xlsx", "")
        self.fileSave = self.fileSave.replace(".xls", "")

        with pd.ExcelWriter(self.fileSave+".xlsx") as writer:
            for plotno in np.sort(df.nr.unique()):
                plot = df[df['nr'] == plotno]
                avg_plot = plot.groupby(pd.Grouper(key='date', freq='D')).mean()  # select the data from plot 2
                avg_plot = avg_plot[avg_plot['N2O_N_mug_m2h'].notna()]
                avg_plot["date"] = avg_plot.index

                n2o_avg_data = avg_plot['N2O_N_mug_m2h'].dropna() * 10000 / 1e9
                n2o_avg = n2o_avg_data.rolling(window=2).mean()
                n2o_avg.iloc[0] = 0.

                timediff = avg_plot["date"].diff() / pd.Timedelta(hours=1)
                timediff.iloc[0] = 0.
                timediff.name = "timediff_hours"

                n2o_sum = n2o_avg * timediff
                n2o_int = n2o_sum.cumsum()
                n2o_int.name = "cumsum_n20"
                # tot_n2o_sum = np.append(tot_n2o_sum, n2o_sum.sum())
                plot.index = plot.date
                n2o_int.index = avg_plot.date

                tmp_df = pd.concat(
                                [avg_plot['nr'],
                                avg_plot['treatment'],
                                avg_plot['N2O_N_mug_m2h'],
                                avg_plot['CO2_C_mug_m2h'],
                                timediff,
                                n2o_int], axis=1)
                tmp_df.to_excel(writer,str(plotno))

    def toExcel_noavg(self):
        self.fileSave = tk.filedialog.asksaveasfilename(initialdir=self.outpath, title="Save file",
                                                        filetypes=(("Excel File", ".xlsx"), ("all files", "*.*")))

        if self.fileSave == "":
            return

        filename = "output/capture_slopes.xls"  # filename for raw output
        filename_manual = self.manual  # filename for raw output
        df_b = pd.read_excel(filename)  # import excel docuument
        df_m = pd.read_excel(filename_manual)
        df_b = pd.concat([df_b, df_m])
        df_b.index = df_b["Unnamed: 0"]

        df_b['date'] = pd.to_datetime(df_b['date'])  # make date column to datetime objects
        df_b = df_b.sort_values(by=['date'])  # sort all entries by date
        df = df_b

        df_w  = make_df_weather(df_b['date'].min(),df_b['date'].max())
        df_b = df_b.sort_values(by=['date'])  # sort all entries by date

        df = pd.merge_asof(df_b,df_w,left_on='date',right_index=True,direction="nearest")

        self.fileSave = self.fileSave.replace(".xlsx", "")
        self.fileSave = self.fileSave.replace(".xls", "")

        print(self.fileSave)

        with pd.ExcelWriter(self.fileSave + ".xlsx") as writer:
            for plotno in np.sort(df.nr.unique()):
                plot = df[df['nr'] == plotno]
                plot.to_excel(writer, str(plotno))


        # self.writer = pd.ExcelWriter(self.fileSave + ".xlsx")
        # self.df.to_excel(self.writer, 'Sheet1')
        # self.writer.save()

    def update(self):
        self.xint = int(self.XINT.get())  # Update the regression window
        self.setParams()
        self.replot()  # Replot the graph

    def reset(self):
        # self.xint = int()  # regression window
        #self.var.set(self.specific_options["ALL"]['interval'])
        self.sliderMax.set(self.specific_options["ALL"]["stop"])
        self.sliderMin.set(self.specific_options["ALL"]["start"])
        self.method.set(self.specific_options["ALL"]["crit"])
        if (self.specific_options["ALL"]["co2_guides"] == True):
            self.C1.select()
        else:
            self.C1.deselect()

        if self.fname in self.specific_options:
            del self.specific_options[self.fname]

        self.update()

    def sel2(self):
        self.method.set("steepest")

    def sel1(self):
        self.method.set("mse")

    def getParams(self):
        self.fname = self.df.loc[self.nr].filename
        if self.fname in self.specific_options.keys():
            name = self.fname
        else:
            name = "ALL"

        self.sliderMin.set(self.specific_options[name]["start"])
        self.sliderMax.set(self.specific_options[name]["stop"])
        self.method.set(self.specific_options[name]['crit'])
        self.xint = self.specific_options[name]["interval"]
        self.var = self.xint
        if (self.specific_options[name]["co2_guides"] == True):
            self.C1.select()
        else:
            self.C1.deselect()
        if (self.specific_options[name]["exclude"] == True):
            self.C2.select()
        else:
            self.C2.deselect()
        self.update()


    def setParams(self):
        self.options["start"] = int(self.sliderMin.get())
        self.options["stop"] = int(self.sliderMax.get())
        self.options['crit'] = self.method.get()
        self.options["interval"] = int(self.XINT.get())
        self.options['co2_guides'] = int(self.CO2_guide.get())
        self.options['exclude'] = int(self.exclude.get())
        if self.options != self.specific_options["ALL"]:
            self.specific_options[self.fname]= copy.deepcopy(self.options)
            if ".pickle" in self.specific_options_filename:
                with open(self.specific_options_filename, 'wb') as handle:
                    pickle.dump(self.specific_options, handle, protocol=pickle.HIGHEST_PROTOCOL)

    def setDefault(self):
        self.specific_options["ALL"]["start"] = int(self.sliderMin.get())
        self.specific_options["ALL"]["stop"] = int(self.sliderMax.get())
        self.specific_options["ALL"]['crit'] = self.method.get()
        self.specific_options["ALL"]["interval"] = int(self.XINT.get())
        self.specific_options["ALL"]["co2_guides"] = int(self.CO2_guide.get())
        self.specific_options["ALL"]["exclude"] = int(self.exclude.get())
        self.getParams()
        self.replot()

    def regress(self):
        self.fname = self.df.loc[self.nr].filename
        self.df_reg = self.df.loc[self.nr]

        datafilename = resdir.raw_data_path + "\\" + self.fname
        meas = find_regressions.plot_raw(datafilename)

        self.regressions = self.regr.find_all_slopes(filename_or_data=datafilename, do_plot=False,
                                                     given_specific_options=self.options)

        reg = self.regressions[self.df_reg["side"]]

        self.segments = find_regressions.get_regression_segments(meas, self.regressions)[self.df_reg["side"]]

        self.co2 = meas["CO2"]  # Get the ppm values
        self.N2O = meas["N2O"]
        self.gndTemp = meas['licor_H2O']
        self.EC = meas['licor_T']
        self.VWC = meas['Wind']

        self.name = self.fname
        self.xLen = len(self.co2)

        self.sMin = self.sliderMin.get()
        self.sMax = self.sliderMax.get()

        self.cutStart = int(self.xLen * (self.sMin / 100.))  # Select cut range as 5% of samples
        self.cutStop = int(self.xLen * (self.sMax / 100.))

        self.co2Cut = [[], []]
        self.co2Cut[0] = self.co2[0][self.sliderMin.get():self.sliderMax.get()]
        self.co2Cut[1] = self.co2[1][self.sliderMin.get():self.sliderMax.get()]

        if self.xint >= (self.cutStop - self.cutStart):
            # if the regression window is larger than the sample window after cutting, throw
            # an error box and set the regression window to sample window
            # messagebox.showinfo("ERROR", "regression window is larger than sample window")
            self.xint = (self.cutStop - self.cutStart) - 3
        # Find the best regression

        # Initialize the graph, we first initialize it here, then we update the values in
        # self.replot()

        self.tmpParams = {"start": self.sMin,
                          "stop": self.sMax,
                          "method": self.method.get(),
                          "reg_window": self.xint}

        self.tmpRegression = {"slope": reg["CO2"].slope,
                              "intercept": reg["CO2"].intercept,
                              "mse_CO2": reg["CO2"].mse,
                              "start": reg["CO2"].start,
                              "stop": reg["CO2"].stop,
                              "diff_CO2": reg["CO2"].max_y - reg["CO2"].min_y
                              }

        return reg

    def replot(self):
        reg = self.regress()

        # Update all of the text boxes
        self.UpdateText("SampleNo", self.nr)
        self.UpdateText("CO2_MUG", str("%.1f" % (flux_calculations.calc_flux(reg["CO2"].slope,self.df_reg["Tc"]) * self.flux_units["CO2"]["factor"])))
        self.UpdateText("N2O_MUG", str("%.3f" % (flux_calculations.calc_flux(reg["N2O"].slope,self.df_reg["Tc"]) * self.flux_units["N2O"]["factor"])))
        self.UpdateText("CO2_SLOPE", str("%.2e" %(reg["CO2"].slope)))
        self.UpdateText("N2O_SLOPE", str("%.2e" %(reg["N2O"].slope)))
        self.UpdateText("mse_CO2", str("%.2e" %(reg["CO2"].mse)))
        self.UpdateText("mse_N2O", str("%.2e" %(reg["N2O"].mse)))
        self.UpdateText("rsq_CO2", str("%.2f" %(reg["CO2"].rsq)))
        self.UpdateText("rsq_N2O", str("%.2f" %(reg["N2O"].rsq)))
        self.UpdateText("diff_CO2", str("%.2e" %(reg["CO2"].max_y - reg["CO2"].min_y)))
        self.UpdateText("diff_N2O", str("%.2e" %(reg["N2O"].max_y - reg["N2O"].min_y)))
        self.UpdateText("side_box", self.df_reg["side"])
        self.UpdateText("airTemp", self.df_reg["Tc"])
        self.UpdateText("precip", self.df_reg["precip"])
        self.UpdateText("Plot NR", self.df_reg["nr"])
        self.UpdateText("Treatment NO", self.df_reg["treatment"])
        self.UpdateText("Treatment Name", self.treatment_legend[self.df_reg["treatment"]]["name"])
        # Update all of the plot lines
        self.title = (self.name +
                      "\n" + str(self.tmpRegression) + "\n" +
                      "AirTemp: %.1f degC     GroundTemp: %.1f degC         EC: %.3f          VWC: %.3f" %
                      (1,
                       2,
                       3,
                       4))
        slopeSegments = self.segments["CO2"]
        slopeLine = slopeFromPoints(reg["CO2"])

        self.fig.suptitle(self.title, fontsize=12)
        self.CO2line1.set_xdata(slopeSegments[0])
        self.CO2line1.set_ydata(slopeSegments[1])  # Update sample values
        self.CO2line2.set_xdata(slopeSegments[2])
        self.CO2line2.set_ydata(slopeSegments[3])
        self.CO2line3.set_xdata(slopeLine[0])  # Update regression values
        self.CO2line3.set_ydata(slopeLine[1])  # Update regression values

        self.CO2start.set_xdata([self.options["start"]]*2)
        self.CO2start.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])
        self.CO2stop.set_xdata([self.options["stop"]]*2)
        self.CO2stop.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])

        slopeSegments = self.segments["N2O"]
        slopeLine = slopeFromPoints(reg["N2O"])

        self.N2Oline1.set_xdata(slopeSegments[0])
        self.N2Oline1.set_ydata(slopeSegments[1])  # Update sample values
        self.N2Oline2.set_xdata(slopeSegments[2])
        self.N2Oline2.set_ydata(slopeSegments[3])
        self.N2Oline3.set_xdata(slopeLine[0])  # Update regression values
        self.N2Oline3.set_ydata(slopeLine[1])  # Update regression values

        self.N2Ostart.set_xdata([self.options["start"]] * 2)
        self.N2Ostart.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])
        self.N2Ostop.set_xdata([self.options["stop"]] * 2)
        self.N2Ostop.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])

        self.ax.relim()  # Set the limits from the values to be graphed
        self.ax.autoscale_view()  # Autoscale to limits
        self.ax1.relim()  # Set the limits from the values to be graphed
        self.ax1.autoscale_view()  # Autoscale to limits

        self.canvas.draw()  # Draw the figure

    def goto(self):
        self.w = popupWindow(self.master)
        self.master.wait_window(self.w.top)
        if not self.w.cancel:
            print(self.w.value, self.w.date)
            newnr = self.w.value
            newdate = self.w.date
            if newnr:
                newnr = int(newnr)
                if newnr >= 0 and newnr <= (len(self.df) - 1):
                    self.nr = newnr
                    self.getParams()
                    self.replot()
                    self.update()
            elif newdate:
                date = datecheck(newdate)
                self.nr = abs((date - self.df['date'])).idxmin()
                self.getParams()
                self.replot()
                self.update()
            else:
                self.nr = abs((datetime.now()-self.df['date'])).idxmin()
                self.getParams()
                self.replot()
                self.update()

    def allplot(self):
        def onpick(event):
            time_start = time()
            df = df_b[
                (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (
                        df_b.date < pd.Timestamp(stop_date.val, unit="d"))]

            if isinstance(event.artist, Line2D):
                thisline = event.artist
                xdata = thisline.get_xdata()
                ydata = thisline.get_ydata()

                ind = event.ind

                points = tuple(zip(xdata[ind], ydata[ind]))
                dropindex = df[(df.nr == int(thisline.get_label())) & (df.date == xdata[ind][0])]
                # df_b.drop(dropindex.index, axis=0, inplace=True)
                #
                # df = df_b[
                #     (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (
                #             df_b.date < pd.Timestamp(stop_date.val, unit="d"))]
                self.nr = dropindex.index[0]
                self.getParams()
                self.update()

                df_1 = df[df.treatment == int(dropindex.treatment)]

                plotDF(df_1, df_w, axs, drop="S")

                fig.canvas.draw()

            elif isinstance(event.artist, Rectangle):
                patch = event.artist
                print(int(patch.get_x() + (patch.get_width() / 2)))
                treatment_no = int(patch.get_x() + (patch.get_width() / 2)) + 1
                treatment_name = treatment_legend[treatment_no]["name"]

                df_1 = df[df.treatment == treatment_no]

                plotDF(df_1, df_w, axs, drop="S")
                fig.canvas.draw()

            elif isinstance(event.artist, Text):
                text = event.artist
                fig2, axs2 = plt.subplots(nrows=2, ncols=1, figsize=(15, 12))
                treatment = treatment_df[treatment_df.name == text.get_text()].index[0]

        def update(val):
            time_start = time()
            df = df_b[
                (df_b.date > pd.Timestamp(start_date.val, unit="d")) & (
                        df_b.date < pd.Timestamp(stop_date.val, unit="d"))]
            plotDF(df, df_w, axs)
            print(time() - time_start)

        def xaligned_axes(ax, y_distance, width, **kwargs):
            return plt.axes([ax.get_position().x0,
                             ax.get_position().y0 - y_distance,
                             ax.get_position().width, width],
                            **kwargs)

        def getN2Odata(df, plotno, tot_n2o_sum=[]):
            # Lazy way of averaging doublepoints on days
            # df = df[df.nr == plotno].groupby(df[df.nr == plotno].date.dt.date).mean()
            # df["date"] = df.index
            plot = df[df['nr'] == plotno]
            avg_plot = plot.groupby(pd.Grouper(key='date', freq='D')).mean()  # select the data from plot 2
            avg_plot = avg_plot[avg_plot['N2O_N_mug_m2h'].notna()]
            avg_plot["date"] = avg_plot.index
            n2o_avg_data = avg_plot['N2O_N_mug_m2h'].dropna() * 10000 / 1e9
            n2o_avg = n2o_avg_data.rolling(window=2).mean()
            n2o_avg.iloc[0] = 0.

            timediff = avg_plot["date"].diff() / pd.Timedelta(hours=1)
            timediff.iloc[0] = 0.

            n2o_sum = n2o_avg * timediff

            n2o_int = n2o_sum.cumsum()

            tot_n2o_sum = np.append(tot_n2o_sum, n2o_sum.sum())
            plot.index = plot.date
            n2o_int.index = avg_plot.date

            plot_n2o = plot['N2O_N_mug_m2h']

            return plot_n2o, tot_n2o_sum, n2o_int

        def run_all_plots(df):
            plotdata = {}
            treatments = {}

            for treatment in np.sort(df['treatment'].unique()):
                # fig, (axs["samples"], axs["cumsum"], axs["cumgraf"]) = plt.subplots(nrows=3, ncols=1, sharex=True)
                tot_n2o_sum = np.array([])
                for plotno in np.sort(df[df['treatment'] == treatment]['nr'].unique()):
                    plot_n2o, tot_n2o_sum, n2o_int = getN2Odata(df, plotno, tot_n2o_sum)
                    plotdata[plotno] = {
                        "name": plotno,
                        "data": plot_n2o,
                        "dataintsum": n2o_int
                    }

                treatments[treatment_legend[treatment]["name"]] = {
                    "avg": np.average(tot_n2o_sum),
                    "stdev": np.std(tot_n2o_sum),
                    "gmean": gmean(df[(df["treatment"] == treatment) & (df.N2O_N_mug_m2h > 0.)].N2O_N_mug_m2h),
                    "gstd": gstd(df[(df["treatment"] == treatment) & (df.N2O_N_mug_m2h > 0.)].N2O_N_mug_m2h)
                }

            return treatments, plotdata

        def plotDF(df, df_w, axs, drop=""):
            treatments, plotdata = run_all_plots(df)
            avgsum = pd.DataFrame.from_dict(treatments, orient='index')

            if "B" not in drop:
                #Plot boxplots
                axs["boxplot"].cla()
                axs["boxplot"].set_yscale('log')

                dataset = []
                geo_avgs = []
                for treatment in np.sort(df.treatment.unique()):
                    plot = df[df['treatment'] == treatment]
                    avg_plot = plot.groupby(pd.Grouper(key='date', freq='D')).mean()  # select the data from plot 2
                    avg_plot = avg_plot[avg_plot['N2O_N_mug_m2h'].notna()][
                        'N2O_N_mug_m2h']  # [avg_plot['N2O_N_mug_m2h']>0]
                    dataset.append(avg_plot)  # np.log(avg_plot))
                axs["boxplot"].boxplot(dataset)
                axs["boxplot"].set_ylim(1, None)
                axs["boxplot"].set_xticklabels(avgsum.index, rotation=20, ha='right')
                axs["boxplot"].set_ylabel(' µG NO-N m⁻²h⁻¹')
                title = "Average " + df.date.min().strftime(
                    "%Y-%m-%d") + " to:" + df.date.max().strftime(
                    "%Y-%m-%d")
                axs["boxplot"].set_title(title)

            if "P" not in drop:
                axs["samples"].cla()
                for plotno in plotdata:
                    axs["samples"].plot(plotdata[plotno]["data"], '-o', picker=True, pickradius=5, label=plotno)
                axs["samples"].set_ylabel(' µG NO-N m⁻²h⁻¹')
                axs["samples"].autoscale()

            if "S" not in drop:
                axs["cumsum"].cla()
                xticks = np.arange(len(avgsum.index))
                axs["cumsum"].set_ylabel('kg ha⁻¹ period⁻¹')
                axs["cumsum"].bar(xticks, avgsum.avg, yerr=avgsum.stdev, align='center', alpha=0.5, ecolor='black',
                                  capsize=6,
                                  picker=True)

                axs["cumsum"].set_xticks(xticks)
                axs["cumsum"].set_xticklabels(avgsum.index, rotation=20, ha='right')

                axs["cumsum"].set_title('Cumulative N2O over %i days' % (df.date.max()-df.date.min()).days)
                axs["cumsum"].yaxis.grid(True)

                for label in axs["cumsum"].get_xticklabels():  # make the xtick labels pickable
                    label.set_picker(True)

            if "C" not in drop:
                axs["cumgraf"].cla()
                for plotno in plotdata:
                    axs["cumgraf"].plot(plotdata[plotno]["dataintsum"], '-o', picker=True, pickradius=5, label=plotno)
                axs["cumgraf"].tick_params(axis='x', rotation=20)

                treatments = df.treatment.unique()
                if len(treatments) > 1:
                    title = "Cumulative from:" + df.date.min().strftime("%Y-%m-%d") + " to:" + df.date.max().strftime(
                        "%Y-%m-%d")
                else:
                    treatment_name = treatment_legend[treatments[0]]["name"]

                    title = treatment_name+" from:" + df.date.min().strftime("%Y-%m-%d") + " to:" + df.date.max().strftime(
                        "%Y-%m-%d")
                axs["cumgraf"].set_title(title)
                axs["cumgraf"].set_ylabel('kg ha⁻¹ period⁻¹')

            if "W" not in drop:
                axs["rain"].cla()
                axs["temp"].cla()
                df_w_ = df_w[df['date'].min():df['date'].max()]
                temp = df_w_.resample("1D")

                axs["rain"].bar(temp['sum(precipitation_amount PT1H)'].sum().keys(),
                                temp['sum(precipitation_amount PT1H)'].sum())
                axs["temp"].plot(temp['air_temperature'].mean(), c="r")
                axs["temp"].fill_between(temp['air_temperature'].max().keys(), temp['air_temperature'].max(),
                                         temp['air_temperature'].min(), color="r", alpha=0.3)
                axs["temp"].set_ylabel('Temp\n°C')
                axs["rain"].set_ylabel('Rain\nMM day⁻¹')


        df_weather = make_logger_data()
        treatment_legend = self.treatment_legend
        treatment_df = pd.DataFrame.from_dict(treatment_legend, orient='index')

        start = time()
        filename =  self.file_path   # filename for raw output
        filename_manual = self.manual  # filename for raw output
        df_a = pd.read_excel(filename)  # import excel docuument
        df_m = pd.read_excel(filename_manual)
        df_b = pd.concat([df_a, df_m])
        df_b.index = df_b["Unnamed: 0"]

        df_b['date'] = pd.to_datetime(df_b['date'])  # make date column to datetime objects

        #df_weather = df_weather[df_b['date'].min():df_b['date'].max()]
        df_w = df_weather
        df_b = df_b.sort_values(by=['date'])  # sort all entries by date
        # df_b = df_b[df_b.side == side]
        df = df_b

        # fig,axs = plt.subplots(nrows=3, ncols=2,figsize=(15, 12))
        fig = plt.figure(figsize=(15, 10))
        axs = {}

        axs["cumsum"] = plt.subplot(3, 3, 1)
        axs["boxplot"] = plt.subplot(3, 3, 2)
        axs["boxplot"].set_yscale('log')
        axs["cumgraf"] = plt.subplot(3, 3, 3)
        axs["samples"] = plt.subplot(3, 3, (4, 6))
        axs["rain"] = plt.subplot(3, 3, (7, 9), sharex=axs["samples"])
        axs["temp"] = axs["rain"].twinx()


        plotDF(df, df_w, axs)

        date_min = int(axs["samples"].get_xlim()[0])
        date_max = int(axs["samples"].get_xlim()[1])
        plt.tight_layout()
        ax_slider1 = xaligned_axes(ax=axs["samples"], y_distance=0.05, width=0.01, facecolor="r")
        ax_slider2 = xaligned_axes(ax=axs["samples"], y_distance=0.07, width=0.01, facecolor="r")
        start_date = Slider(ax_slider1, 'Start', date_min, date_max, valinit=date_min, valstep=1, dragging=False)
        stop_date = Slider(ax_slider2, 'Stop', date_min, date_max, valinit=date_max, valstep=1, dragging=False)
        # df = df.set_index('date')

        fig.canvas.mpl_connect('pick_event', onpick)
        start_date.on_changed(update)
        stop_date.on_changed(update)

        plt.show()

    def decrease(self):
        # If the measurement counter is above zero, increment with one
        if self.nr > 0:
            self.nr -= 1
            self.getParams()
            self.replot()

    def increase(self):
        # If the measurement counter is below number of measurements, becrement with one
        if self.nr < self.maxf - 1:
            self.nr += 1
            self.getParams()
            self.replot()

    def dropMeasurement(self):
        a = 1
    def viewSpecificOptions(self):
        popup = SpecificOptionsPopup(self.master, self.specific_options, self.on_specific_option_selected)

    def viewDataFrame(self):
        # Always open the column selection popup, passing the current selection if it exists
        column_selection_popup = ColumnSelectionPopup(
            self.master,
            self.df.columns,
            self.on_columns_selected,
            preselected_columns=self.persistent_column_selection
        )
    def on_columns_selected(self, selected_columns):
        # Update the stored selection
        self.persistent_column_selection = selected_columns
        print(selected_columns)
        # Open the Dataframe_Filter_Popup with the selected columns
        popup = Dataframe_Filter_Popup(self.master, self.df[selected_columns], self.on_DF_selected)
    def on_DF_selected(self, selected_key):
        # Handle the selected key here
        print(f"Selected file: {selected_key}")
        # You can now use selected_key as needed in your main application
        print(selected_key)
        self.nr = selected_key
        self.getParams()
        self.replot()
        self.update()
    def on_specific_option_selected(self, selected_key):
        # Handle the selected key here
        print(f"Selected file: {selected_key}")
        # You can now use selected_key as needed in your main application
        print(self.find_by_filename(selected_key))
        self.nr = self.find_by_filename(selected_key)
        self.getParams()
        self.replot()
        self.update()

    def find_by_filename(self, filename):
        # Create a boolean series where True corresponds to rows with the matching filename
        match = self.df['filename'] == filename

        # Check if there's at least one match
        if match.any():
            # Return the index of the first True value
            return match.idxmax()
        else:
            return None

    def UpdateText(self, name, value):
        self.Outs[name].configure(state="normal")
        # update the slope textbox
        self.Outs[name].delete(1.0, 15.0)
        self.Outs[name].insert(1.0, value)
        self.Outs[name].configure(state="disabled")

    def MakeTextbox(self, name, label, row_disp, frame, collumnbox=1, collumntext=0, state="disabled", width=9, cspan=1):
        self.Outs[name + "label"] = tk.Label(frame, text=label)
        self.Outs[name + "label"].grid(row=row_disp, column=collumntext, padx=5, pady=5)
        # Regression slope text display
        self.Outs[name] = tk.Text(frame, height=1, width=width)
        # Placement of regression text display
        self.Outs[name].grid(row=row_disp, column=collumnbox, padx=5, pady=5,columnspan = cspan)
        self.Outs[name].configure(state=state)  # Disable to prevent user input



# Example usage
if __name__ == "__main__":
    root = tk.Tk()
    root.withdraw()  # Hide the main window

    specific_options_filename = 'specific_options.pickle'

    with open(specific_options_filename, 'rb') as handle:
        specific_options = pickle.load(handle)

    popup = SpecificOptionsPopup(root, specific_options)
    root.mainloop()
